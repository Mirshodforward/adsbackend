import { Injectable, Logger } from '@nestjs/common';
import { BalanceService } from '../../balance/balance.service.js';
import { fail } from '../../common/http.js';
import {
  Prisma,
  type FundingKind,
  type FundingOperation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../../telegram-ads/telegram-ads.client.js';
import type {
  Ad as TgAd,
  CreateAdParams,
} from '../../telegram-ads/telegram-ads.types.js';
import { toAdRow } from '../ad-row.js';

/** Telegram yopiq e'londan budjetni faqat 10 daqiqa nofaollikdan keyin qaytaradi. */
export const CLOSE_DELAY_MS = 11 * 60_000;
/** So'rov yo'lida bajarilayotgan amalga sinxronlash aralashmasin. */
const RECONCILE_AFTER_MS = 2 * 60_000;

/** Javob kelmagan yoki server band — natija noma'lum, xuddi shu kalit bilan qayta urinish kerak. */
function isRetryable(e: unknown) {
  return (
    e instanceof TelegramAdsError &&
    (e.code === 'NETWORK_ERROR' ||
      e.code === 'IDEMPOTENT_REQUEST_IN_PROGRESS' ||
      /^HTTP_5\d\d$/.test(e.code))
  );
}

const errorCode = (e: unknown) =>
  e instanceof TelegramAdsError ? e.code : 'UNKNOWN';

/**
 * Mijoz puli ↔ Telegram Ads budjeti.
 *
 * Tartib: (1) bitta tranzaksiyada balans yechiladi va `FundingOperation`
 * yoziladi; (2) Telegram chaqiriladi, `idempotency_key` = amal id'si;
 * (3) natija yoziladi. Telegram aniq rad etsa — pul qaytadi. Javob kelmasa —
 * amal PENDING qoladi va sinxronlash uni xuddi shu kalit bilan qayta yuboradi:
 * Telegram 24 soat davomida birinchi natijani qaytaradi, pul ikki marta o'tmaydi.
 */
@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly balance: BalanceService,
  ) {}

  /** Balansdan yechib, amalni yaratadi. Pul yetmasa — 402, hech narsa yozilmaydi. */
  start(
    userId: string,
    kind: Extract<FundingKind, 'CREATE_AD' | 'ADD_BUDGET'>,
    amounts: { uzs: number; ton: number },
    request: object,
    adId?: number,
  ): Promise<FundingOperation> {
    return this.db.$transaction(async (tx) => {
      const op = await tx.fundingOperation.create({
        data: {
          userId,
          kind,
          adId,
          amountUzs: amounts.uzs,
          amountTon: amounts.ton,
          request,
        },
      });
      const debited = await this.balance.debitForFunding(
        tx,
        userId,
        amounts.uzs,
        { operationId: op.id, adId },
      );
      if (!debited) fail("Balansda mablag' yetarli emas", 402);
      return op;
    });
  }

  /** E'lonni yakunlash: qoldiq 10+ daqiqadan keyin balansga qaytadi. */
  scheduleClose(userId: string, adId: number) {
    return this.db.fundingOperation.create({
      data: {
        userId,
        kind: 'CLOSE_AD',
        adId,
        amountUzs: 0,
        amountTon: 0,
        request: {},
        notBefore: new Date(Date.now() + CLOSE_DELAY_MS),
      },
    });
  }

  /** Telegram'ga yuboradi; qaytaradi — amalning yangi holati. */
  async execute(op: FundingOperation): Promise<FundingOperation> {
    try {
      if (op.kind === 'CLOSE_AD') await this.close(op);
      else await this.complete(op, await this.call(op));
    } catch (e) {
      const code = errorCode(e);
      if (op.kind === 'CLOSE_AD' || isRetryable(e)) {
        // Natija noma'lum yoki hali erta (yakunlash) — keyinroq qayta urinamiz.
        this.logger.warn(`${op.kind} ${op.id}: ${code} — qayta uriniladi`);
        await this.db.fundingOperation.update({
          where: { id: op.id },
          data: {
            attempts: { increment: 1 },
            error: code,
            ...(op.kind === 'CLOSE_AD' && {
              notBefore: new Date(Date.now() + CLOSE_DELAY_MS),
            }),
          },
        });
      } else {
        this.logger.warn(`${op.kind} ${op.id}: ${code} — pul qaytarildi`);
        await this.failAndRefund(op, code);
      }
    }
    return this.db.fundingOperation.findUniqueOrThrow({ where: { id: op.id } });
  }

  /** Sinxronlashdan: javobi kelmay qolgan va vaqti kelgan amallar. */
  async reconcile() {
    const now = Date.now();
    const ops = await this.db.fundingOperation.findMany({
      where: {
        status: 'PENDING',
        OR: [
          {
            notBefore: null,
            updatedAt: { lt: new Date(now - RECONCILE_AFTER_MS) },
          },
          { notBefore: { lte: new Date(now) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const op of ops) await this.execute(op);
  }

  /** Har sinxronlashda: Telegram'dagi sarf × o'rtacha kurs → mijoz sarfi (so'm). */
  async updateSpend() {
    const clientAds = await this.db.clientAd.findMany({
      where: { fundedTon: { gt: 0 } },
      include: { ad: { select: { spentBudget: true } } },
    });
    for (const ca of clientAds) {
      const rate = ca.fundedUzs.div(ca.fundedTon);
      const cap = ca.fundedUzs.minus(ca.refundedUzs);
      const spent = Prisma.Decimal.min(
        cap,
        ca.ad.spentBudget.mul(rate).toDecimalPlaces(2),
      );
      if (!spent.eq(ca.spentUzs)) {
        await this.db.clientAd.update({
          where: { adId: ca.adId },
          data: { spentUzs: spent },
        });
      }
    }
  }

  private call(op: FundingOperation): Promise<TgAd> {
    const request = op.request as unknown as CreateAdParams;
    if (op.kind === 'CREATE_AD') {
      return this.ads.createAd({ ...request, idempotency_key: op.id });
    }
    return this.ads.increaseAdBudget({
      ad_id: op.adId!,
      amount: op.amountTon.toNumber(),
      idempotency_key: op.id,
    });
  }

  private async complete(op: FundingOperation, ad: TgAd) {
    const row = toAdRow(ad);
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.fundingOperation.updateMany({
        where: { id: op.id, status: 'PENDING' },
        data: { status: 'DONE', adId: ad.ad_id, error: null },
      });
      if (claimed.count === 0) return; // boshqa urinish allaqachon yakunlagan
      await tx.ad.upsert({
        where: { adId: ad.ad_id },
        create: row,
        update: row,
      });
      if (op.kind === 'CREATE_AD') {
        await tx.clientAd.create({
          data: {
            adId: ad.ad_id,
            userId: op.userId,
            fundedUzs: op.amountUzs,
            fundedTon: op.amountTon,
          },
        });
        await tx.balanceEntry.updateMany({
          where: { operationId: op.id },
          data: { adId: ad.ad_id },
        });
      } else {
        await tx.clientAd.update({
          where: { adId: ad.ad_id },
          data: {
            fundedUzs: { increment: op.amountUzs },
            fundedTon: { increment: op.amountTon },
          },
        });
      }
    });
  }

  private async close(op: FundingOperation) {
    const adId = op.adId!;
    const [current] = await this.ads.getAdsById({ ad_ids: [adId] });
    let remaining = current?.remaining_budget ?? 0;
    let ad = current;
    if (remaining > 0) {
      ad = await this.ads.decreaseAdBudget({
        ad_id: adId,
        amount: remaining,
        idempotency_key: op.id,
      });
    } else {
      remaining = 0;
    }

    await this.db.$transaction(async (tx) => {
      const ca = await tx.clientAd.findUniqueOrThrow({ where: { adId } });
      const held = ca.fundedUzs.minus(ca.spentUzs).minus(ca.refundedUzs);
      const refund = ca.fundedTon.gt(0)
        ? Prisma.Decimal.min(
            held,
            new Prisma.Decimal(remaining)
              .mul(ca.fundedUzs.div(ca.fundedTon))
              .toDecimalPlaces(2),
          )
        : new Prisma.Decimal(0);

      const claimed = await tx.fundingOperation.updateMany({
        where: { id: op.id, status: 'PENDING' },
        data: {
          status: 'DONE',
          amountTon: remaining,
          amountUzs: refund,
          error: null,
        },
      });
      if (claimed.count === 0) return;
      if (refund.gt(0)) {
        await this.balance.refund(tx, op.userId, refund, {
          operationId: op.id,
          adId,
          note: "E'lon yakunlandi — ishlatilmagan budjet",
        });
      }
      await tx.clientAd.update({
        where: { adId },
        data: { refundedUzs: { increment: refund }, closedAt: new Date() },
      });
      if (ad) {
        const row = toAdRow(ad);
        await tx.ad.update({ where: { adId }, data: row });
      }
    });
  }

  private async failAndRefund(op: FundingOperation, code: string) {
    await this.db.$transaction(async (tx) => {
      // Shartli: bir amal ikki marta qaytarilmaydi.
      const claimed = await tx.fundingOperation.updateMany({
        where: { id: op.id, status: 'PENDING' },
        data: { status: 'FAILED', error: code },
      });
      if (claimed.count === 0) return;
      await this.balance.refund(tx, op.userId, op.amountUzs, {
        operationId: op.id,
        adId: op.adId ?? undefined,
        note: `Telegram qabul qilmadi: ${code}`,
      });
    });
  }
}
