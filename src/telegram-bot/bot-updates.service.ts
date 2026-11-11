import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BOT_LANGS,
  botCommands,
  botLang,
  botProfile,
  fallbackMessage,
  helpMessage,
  menuKeyboard,
  parseCommand,
  startMessage,
  type BotAccount,
} from './bot-texts.js';
import { TelegramBotService } from './telegram-bot.service.js';

/**
 * Webhook siri bot tokenidan hosil qilinadi: alohida sozlama kerak emas, token
 * almashsa sir ham almashadi (keyingi ishga tushishda webhook qayta o'rnatiladi).
 * Tokenni bilgan baribir botni boshqara oladi — himoya darajasi bir xil.
 */
export const webhookSecret = (botToken: string) =>
  createHmac('sha256', botToken)
    .update('osontarget-telegram-webhook')
    .digest('hex');

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Update'ning bizga kerakli qismi; qolgan maydonlar tashlab yuboriladi. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z
        .object({
          id: z.number().int(),
          first_name: z.string().optional(),
          language_code: z.string().optional(),
        })
        .optional(),
      text: z.string().optional(),
    })
    .optional(),
});

/**
 * @Osontarget_bot'ga kelgan xabarlar (webhook orqali): /start — salom va menyu,
 * /help — yordam, boshqa har qanday xabar — qisqa ko'rsatma va o'sha menyu.
 */
@Injectable()
export class BotUpdatesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotUpdatesService.name);
  private readonly secret: Buffer;

  constructor(
    private readonly bot: TelegramBotService,
    private readonly db: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const token = config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    this.secret = digest(webhookSecret(token));
  }

  /** `X-Telegram-Bot-Api-Secret-Token` — so'rov haqiqatan Telegram'danmi. */
  verifySecret(provided?: string): boolean {
    return (
      typeof provided === 'string' &&
      timingSafeEqual(digest(provided), this.secret)
    );
  }

  /**
   * Hech qachon xato tashlamaydi: Telegram 2xx olmasa o'sha update'ni qayta-qayta
   * yuboradi va keyingilari navbatda qoladi. Muammo faqat logga yoziladi.
   */
  async handle(body: unknown): Promise<void> {
    try {
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        this.logger.warn('Tanilmagan update — tashlab yuborildi');
        return;
      }
      const msg = parsed.data.message;
      // Guruhlarda javob bermaymiz: u yerda web_app tugmalari ishlamaydi.
      if (!msg?.from || msg.chat.type !== 'private') return;

      const lang = botLang(msg.from.language_code);
      const command = parseCommand(msg.text);
      const text =
        command === 'start'
          ? startMessage(
              lang,
              msg.from.first_name ?? '',
              await this.account(msg.from.id),
            )
          : command === 'help'
            ? helpMessage(lang)
            : fallbackMessage(lang);

      await this.bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: menuKeyboard(
          lang,
          this.config.get('FRONTEND_URL', { infer: true }),
        ),
      });
    } catch (e) {
      this.logger.error(
        `Update qayta ishlanmadi: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Ro'yxatdan o'tgan faol mijoz bo'lsa — balans va mijoz raqami. */
  private async account(telegramId: number): Promise<BotAccount | undefined> {
    try {
      const user = await this.db.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
        select: { isActive: true, clientId: true, balanceUzs: true },
      });
      if (!user?.isActive) return undefined;
      return { clientId: user.clientId, freeUzs: Number(user.balanceUzs) };
    } catch (e) {
      // Baza yiqilsa ham salom va menyu ketsin — faqat balanssiz.
      this.logger.warn(
        `Mijoz topilmadi (baza): ${e instanceof Error ? e.message : e}`,
      );
      return undefined;
    }
  }

  onApplicationBootstrap() {
    const url = this.config.get('TELEGRAM_WEBHOOK_URL', { infer: true });
    // Ishga tushish Telegram'ni kutmaydi; xatolar logga yoziladi, xolos.
    if (!url) return;
    this.setup(url).catch((e: unknown) =>
      this.logger.error(
        `Bot sozlanmadi: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  /**
   * Webhook, buyruqlar menyusi va (bo'sh bo'lsa) bot tavsifi. Har ishga
   * tushishda takrorlanadi — Telegram tomonida hammasi idempotent. Tavsifni
   * egasi @BotFather'da o'zgartirgan bo'lsa, ustidan yozmaymiz.
   */
  async setup(url: string): Promise<void> {
    const ok = await this.bot.api<boolean>('setWebhook', {
      url,
      secret_token: webhookSecret(
        this.config.get('TELEGRAM_BOT_TOKEN', { infer: true }),
      ),
      allowed_updates: ['message'],
      max_connections: 10,
    });
    if (ok) this.logger.log(`Webhook o'rnatildi: ${url}`);

    for (const lang of BOT_LANGS) {
      // uz — standart (tili belgilanmagan hamma uchun), ru/en — alohida.
      const language_code = lang === 'uz' ? undefined : lang;
      const profile = botProfile(lang);
      await this.bot.api('setMyCommands', {
        commands: botCommands(lang),
        scope: { type: 'all_private_chats' },
        language_code,
      });
      const desc = await this.bot.api<{ description: string }>(
        'getMyDescription',
        { language_code },
      );
      if (desc && !desc.description) {
        await this.bot.api('setMyDescription', {
          description: profile.description,
          language_code,
        });
      }
      const short = await this.bot.api<{ short_description: string }>(
        'getMyShortDescription',
        { language_code },
      );
      if (short && !short.short_description) {
        await this.bot.api('setMyShortDescription', {
          short_description: profile.shortDescription,
          language_code,
        });
      }
    }
  }
}
