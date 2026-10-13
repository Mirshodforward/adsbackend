import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceService } from '../balance/balance.service.js';
import { fail } from '../common/http.js';
import type { Env } from '../config/env.js';
import {
  Prisma,
  type Topup,
  type TopupMethod,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import { GATEWAY_METHODS, payAmount, type GatewayMethod } from './methods.js';
import {
  PaylinkerClient,
  PaylinkerError,
  type PaylinkerInvoiceStatus,
} from './paylinker/paylinker.client.js';
import { buildPaynetAppUrl } from './paylinker/paynet-link.js';

/** `BalanceEntry.source` — Paylinker kirimlari. externalId = Paylinker invoice ID. */
export const PAYLINKER_SOURCE = 'PAYLINKER';

/** Invoice yaratilgunga qadar vaqtinchalik muddat; keyin Paylinker'niki yoziladi. */
const PLACEHOLDER_TTL_MS = 30 * 60_000;
/** Bitta mijozda bir vaqtda shuncha kutilayotgan to'ldirish — undan ko'pi spam. */
const MAX_PENDING = 5;
/** Webhook shundan kechiksa, holat Paylinker'dan to'g'ridan-to'g'ri so'raladi. */
const POLL_AFTER_MS = 15_000;

/** Webhook va zaxira so'rov keltiradigan invoice holati — ikkalasi bir yo'ldan. */
export interface InvoiceUpdate {
  id: string;
  externalId: string;
  status: PaylinkerInvoiceStatus;
  /** So'mda */
  amount: number;
  underReview?: boolean;
}

export type ApplyResult =
  | 'credited'
  | 'duplicate'
  | 'held'
  | 'underpaid'
  | 'updated'
  | 'unknown'
  | 'ignored';

export interface TopupDto {
  id: string;
  method: TopupMethod;
  status: Topup['status'];
  creditUzs: number;
  payUzs: number;
  payUrl: string | null;
  accountNumber: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
}

const toDto = (t: Topup): TopupDto => ({
  id: t.id,
  method: t.method,
  status: t.status,
  creditUzs: t.creditUzs.toNumber(),
  payUzs: t.payUzs.toNumber(),
  payUrl: t.payUrl,
  accountNumber: t.accountNumber,
  expiresAt: t.expiresAt,
  paidAt: t.paidAt,
  createdAt: t.createdAt,
});

const fmt = (n: number | Prisma.Decimal) =>
  Number(n).toLocaleString('ru-RU').replace(/ /g, ' ');

@Injectable()
export class TopupsService {
  private readonly logger = new Logger(TopupsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly balance: BalanceService,
    private readonly paylinker: PaylinkerClient,
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Hozir mijozga ko'rsatiladigan usullar. Paylinker sozlanmagan bo'lsa — bo'sh. */
  methods(): GatewayMethod[] {
    if (!this.paylinker.configured) return [];
    const allowed = new Set(
      this.config.get('PAYMENT_METHODS', { infer: true }),
    );
    const paynet = this.config.get('PAYNET_APP_MERCHANT', { infer: true });
    return GATEWAY_METHODS.filter(
      (m) => allowed.has(m.code) && (m.code !== 'PAYNET' || Boolean(paynet)),
    );
  }

  limits() {
    return {
      minUzs: this.config.get('TOPUP_MIN_UZS', { infer: true }),
      maxUzs: this.config.get('TOPUP_MAX_UZS', { infer: true }),
      feePercent: this.config.get('TOPUP_FEE_PERCENT', { infer: true }),
    };
  }

  async create(
    userId: string,
    code: string,
    amountUzs: number,
  ): Promise<TopupDto> {
    const method = this.methods().find((m) => m.code === code);
    if (!method) fail("Bu to'lov usuli hozir ishlamayapti", 400);

    const { minUzs, maxUzs, feePercent } = this.limits();
    if (
      !Number.isInteger(amountUzs) ||
      amountUzs < minUzs ||
      amountUzs > maxUzs
    ) {
      fail(
        `Summa ${fmt(minUzs)} – ${fmt(maxUzs)} so'm oralig'ida bo'lishi kerak`,
        400,
      );
    }

    const now = new Date();

    // Mijoz ikki marta bossa yoki sahifani yangilasa — o'sha to'lov qaytadi,
    // Paylinker'da yangi invoice ochilmaydi.
    const same = await this.db.topup.findFirst({
      where: {
        userId,
        method: method.code,
        status: 'PENDING',
        creditUzs: amountUzs,
        payUrl: { not: null },
        expiresAt: { gt: new Date(now.getTime() + 2 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (same) return toDto(same);

    const pending = await this.db.topup.count({
      where: { userId, status: 'PENDING', expiresAt: { gt: now } },
    });
    if (pending >= MAX_PENDING) {
      fail(
        "To'lanmagan to'ldirishlaringiz ko'p — avval ularni yakunlang yoki muddati o'tishini kuting",
        429,
      );
    }

    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { clientId: true },
    });
    const pay = payAmount(amountUzs, feePercent);

    const topup = await this.db.topup.create({
      data: {
        userId,
        method: method.code,
        creditUzs: amountUzs,
        payUzs: pay,
        expiresAt: new Date(now.getTime() + PLACEHOLDER_TTL_MS),
      },
    });

    try {
      const invoice = await this.paylinker.createInvoice({
        externalId: topup.id,
        amount: pay,
        provider: method.provider,
        description: `OsonTarget balansi — ${fmt(amountUzs)} so'm (mijoz ${user.clientId})`,
        returnUrl: `${this.config.get('FRONTEND_URL', { infer: true })}/dashboard/balance/topup?topup=${topup.id}`,
        metadata: { userId, clientId: user.clientId, topupId: topup.id },
      });

      // Paylinker PAYNET uchun havola bermaydi — Paynet ilovasi havolasini o'zimiz quramiz
      const payUrl =
        method.code === 'PAYNET' && invoice.accountNumber
          ? buildPaynetAppUrl(
              this.config.get('PAYNET_APP_MERCHANT', { infer: true })!,
              invoice.accountNumber,
              pay,
            )
          : invoice.payUrl;
      if (!payUrl)
        throw new PaylinkerError(
          'NO_PAY_URL',
          undefined,
          "Paylinker to'lov havolasini qaytarmadi",
        );

      const saved = await this.db.topup.update({
        where: { id: topup.id },
        data: {
          paylinkerInvoiceId: invoice.id,
          payUrl,
          accountNumber: invoice.accountNumber,
          expiresAt: invoice.expiresAt
            ? new Date(invoice.expiresAt)
            : topup.expiresAt,
        },
      });
      this.logger.log(
        `To'ldirish ${saved.id}: ${method.code} ${pay} so'm (invoice ${invoice.id})`,
      );
      return toDto(saved);
    } catch (e) {
      const code = e instanceof PaylinkerError ? e.code : 'INTERNAL';
      await this.db.topup.update({
        where: { id: topup.id },
        data: { status: 'FAILED', error: code },
      });
      this.logger.error(
        `To'ldirish ${topup.id} yaratilmadi: ${code} ${e instanceof Error ? e.message : ''}`,
      );
      fail(
        "To'lov tizimi javob bermadi. Birozdan keyin qayta urinib ko'ring",
        502,
      );
    }
  }

  async get(userId: string, id: string): Promise<TopupDto> {
    let topup = await this.db.topup.findFirst({ where: { id, userId } });
    if (!topup) fail("To'ldirish topilmadi", 404);

    // Webhook kechiksa — Paylinker'dan jonli holat (frontend shu endpoint'ni so'raydi)
    if (
      topup.status === 'PENDING' &&
      Date.now() - topup.createdAt.getTime() > POLL_AFTER_MS
    ) {
      await this.refresh(topup).catch((e) =>
        this.logger.warn(
          `So'rov ${topup!.id}: ${e instanceof Error ? e.message : e}`,
        ),
      );
      topup = await this.db.topup.findUniqueOrThrow({ where: { id } });
    }
    return toDto(topup);
  }

  async list(userId: string): Promise<TopupDto[]> {
    const rows = await this.db.topup.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(toDto);
  }

  /**
   * Invoice holatini to'ldirishga qo'llash — webhook ham, zaxira so'rov ham shu
   * yerdan o'tadi. Takror chaqirilsa xavfsiz.
   *
   * TARTIB MUHIM: avval `credit()` (u (source, externalId) bo'yicha idempotent —
   * haqiqat manbai), keyin to'ldirish holati. Ikkinchi qadam yiqilsa, Paylinker
   * webhook'ni qayta uradi: `credit()` bu safar `credited:false` qaytaradi va
   * holat to'g'rilanadi. Teskari tartibda "to'langan, lekin balansga tushmagan"
   * holat qolishi mumkin edi.
   */
  async applyInvoice(inv: InvoiceUpdate): Promise<ApplyResult> {
    const topup = await this.db.topup.findUnique({
      where: { id: inv.externalId },
    });
    if (!topup) return 'unknown';
    if (topup.paylinkerInvoiceId && topup.paylinkerInvoiceId !== inv.id) {
      this.logger.error(
        `To'ldirish ${topup.id}: boshqa invoice keldi (${inv.id} ≠ ${topup.paylinkerInvoiceId})`,
      );
      return 'ignored';
    }

    switch (inv.status) {
      case 'PAID': {
        // Paylinker xavf tekshiruvida ushlab turgan to'lov: webhook kelmaydi, faqat
        // so'rovda ko'rinadi. Admin tasdiqlamaguncha balansga yozmaymiz.
        if (inv.underReview) return 'held';

        // Paylinker summani o'zi tekshiradi — bu yerga yetib kelsa, nimadir jiddiy buzilgan.
        // FAILED: solishtirish uni qayta-qayta olmasin; pulni admin qo'lda hal qiladi.
        if (new Prisma.Decimal(inv.amount).lt(topup.payUzs)) {
          const r = await this.db.topup.updateMany({
            where: { id: topup.id, status: 'PENDING' },
            data: {
              status: 'FAILED',
              error: `UNDERPAID ${inv.amount} < ${topup.payUzs.toString()}`,
            },
          });
          this.logger.error(
            `To'ldirish ${topup.id}: kam to'landi (${inv.amount} < ${topup.payUzs.toString()})`,
          );
          if (r.count) {
            void this.alertAdmins(
              `⚠️ Kam to'langan to'ldirish ${topup.id}: ${fmt(inv.amount)} < ${fmt(topup.payUzs)} so'm ` +
                `(invoice ${inv.id}). Balansga yozilmadi.`,
            );
          }
          return 'underpaid';
        }

        const { credited, balanceUzs } = await this.balance.credit(
          topup.userId,
          topup.creditUzs,
          {
            source: PAYLINKER_SOURCE,
            externalId: inv.id,
            note: `${topup.method} orqali to'ldirish (${topup.id})`,
          },
        );
        await this.db.topup.updateMany({
          where: { id: topup.id, status: { not: 'PAID' } },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            paylinkerInvoiceId: inv.id,
            error: null,
          },
        });

        if (credited) {
          this.logger.log(
            `To'ldirildi ${topup.id}: +${topup.creditUzs.toString()} so'm → ${balanceUzs.toString()}`,
          );
          void this.notifyCredited(topup, balanceUzs);
        }
        return credited ? 'credited' : 'duplicate';
      }

      case 'EXPIRED':
      case 'CANCELLED':
      case 'FAILED': {
        await this.db.topup.updateMany({
          where: { id: topup.id, status: 'PENDING' },
          data: { status: inv.status },
        });
        return 'updated';
      }

      case 'REFUNDED': {
        // Pul provider kabinetidan qaytarilgan. Balansdan yechish avtomatik emas:
        // mijoz uni allaqachon e'longa sarflagan bo'lishi mumkin — admin hal qiladi.
        const r = await this.db.topup.updateMany({
          where: { id: topup.id, status: 'PAID' },
          data: { status: 'REFUNDED' },
        });
        if (r.count) {
          this.logger.warn(
            `To'ldirish ${topup.id} QAYTARILDI — balansni admin tuzatishi kerak`,
          );
          void this.alertAdmins(
            `↩️ To'ldirish qaytarildi: ${topup.id}, ${fmt(topup.creditUzs)} so'm (invoice ${inv.id}). ` +
              `Mijoz balansidan avtomatik yechilmadi — qo'lda tuzating.`,
          );
        }
        return 'updated';
      }

      default:
        return 'ignored'; // PENDING / PREPARED — hali hech narsa bo'lmagan
    }
  }

  /** Paylinker'dan jonli holat. */
  async refresh(topup: Topup): Promise<ApplyResult | null> {
    if (!this.paylinker.configured || !topup.paylinkerInvoiceId) return null;
    const inv = await this.paylinker.getInvoiceByExternalId(topup.id);
    if (!inv) return null;
    return this.applyInvoice(inv);
  }

  /**
   * Webhook yo'qolgan yoki kechikkan to'ldirishlarni Paylinker bilan solishtirish.
   * Muddati o'tganlarigina olinadi: tirik to'ldirishni webhook va frontend so'rovi yopadi.
   *
   * Navbat `updatedAt` bo'yicha va har tekshiruvdan keyin u yangilanadi: Paylinker'da
   * hal bo'lmay qolganlari (masalan, xavf tekshiruvida turgani) navbat boshini band
   * qilib, qolganlarini to'sib qo'ymasin.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    if (!this.paylinker.configured) return;
    const stale = await this.db.topup.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
        paylinkerInvoiceId: { not: null },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const t of stale) {
      try {
        const r = await this.refresh(t);
        if (r && r !== 'ignored') this.logger.log(`Solishtirish ${t.id}: ${r}`);
      } catch (e) {
        this.logger.warn(
          `Solishtirish ${t.id}: ${e instanceof Error ? e.message : e}`,
        );
      }
      await this.db.topup.updateMany({
        where: { id: t.id, status: 'PENDING' },
        data: { updatedAt: new Date() },
      });
    }
  }

  private async alertAdmins(text: string): Promise<void> {
    for (const id of this.config.get('ADMIN_TELEGRAM_IDS', { infer: true })) {
      await this.bot.sendMessage(id, text);
    }
  }

  private async notifyCredited(
    topup: Topup,
    balanceUzs: Prisma.Decimal,
  ): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { id: topup.userId },
      select: { telegramId: true },
    });
    if (!user) return;
    await this.bot.sendMessage(
      user.telegramId,
      `✅ Balans to'ldirildi: +${fmt(topup.creditUzs)} so'm\n` +
        // `credit()` bo'sh balansni qaytaradi (e'lonlardagi qoldiqsiz) — shunday ataymiz
        `💰 E'lonlarga ishlatish mumkin: ${fmt(balanceUzs)} so'm`,
    );
  }
}
