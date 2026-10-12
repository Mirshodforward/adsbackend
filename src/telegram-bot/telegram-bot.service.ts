import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * @Osontarget_bot nomidan xabar yuborish. Bot foydalanuvchiga faqat u ruxsat
 * bergan bo'lsa yoza oladi — Login Widget `request_access=write` bilan so'raydi.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Yiqilsa faqat log yoziladi: bildirishnoma asosiy ishni to'xtatmasin. */
  async sendMessage(chatId: bigint | string, text: string): Promise<boolean> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.toString(),
            text,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = (await res.json()) as { ok: boolean; description?: string };
      if (!body.ok) {
        this.logger.warn(`sendMessage(${chatId}): ${body.description}`);
      }
      return body.ok;
    } catch (e) {
      // URL'da token bor — xatoning faqat matnini yozamiz.
      this.logger.warn(
        `sendMessage(${chatId}): ${e instanceof Error ? e.message : 'xato'}`,
      );
      return false;
    }
  }
}
