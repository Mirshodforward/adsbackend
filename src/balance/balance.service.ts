import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;
type Amount = Prisma.Decimal | number | string;

export interface CreditOptions {
  /** To'lov manbasi, masalan `PAYLINKER`, `CARD_SMS`. */
  source: string;
  /** Manbadagi tranzaksiya id'si — (source, externalId) jurnalda yagona. */
  externalId: string;
  note?: string;
}

/** `BalanceEntry.source` — do'kon xaridi va uning qaytarilishi (externalId = ShopOrder.id). */
export const SHOP_SOURCE = 'SHOP';
export const SHOP_REFUND_SOURCE = 'SHOP_REFUND';

function toAmount(value: Amount): Prisma.Decimal {
  const amount = new Prisma.Decimal(value);
  if (amount.lte(0) || amount.decimalPlaces() > 2) {
    throw new Error(`Noto'g'ri summa: ${value}`);
  }
  return amount;
}

/**
 * Mijozning bo'sh balansi (so'm). Har bir o'zgarish `BalanceEntry` jurnali
 * bilan BITTA tranzaksiyada yoziladi; balansni boshqa joyda o'zgartirmang.
 */
@Injectable()
export class BalanceService {
  constructor(private readonly db: PrismaService) {}

  /**
   * To'lov orqali kirim. Bir xil (source, externalId) qayta kelsa hech narsa
   * qilmaydi va `credited: false` qaytaradi — webhook takrori xavfsiz.
   */
  async credit(
    userId: string,
    amountUzs: Amount,
    opts: CreditOptions,
  ): Promise<{ credited: boolean; balanceUzs: Prisma.Decimal }> {
    const amount = toAmount(amountUzs);
    try {
      return await this.db.$transaction(async (tx) => {
        const { balanceUzs } = await tx.user.update({
          where: { id: userId },
          data: { balanceUzs: { increment: amount } },
          select: { balanceUzs: true },
        });
        await tx.balanceEntry.create({
          data: {
            userId,
            type: 'TOPUP',
            amountUzs: amount,
            balanceAfterUzs: balanceUzs,
            source: opts.source,
            externalId: opts.externalId,
            note: opts.note,
          },
        });
        return { credited: true, balanceUzs };
      });
    } catch (e) {
      // Unique (source, externalId) buzildi — bu kirim allaqachon yozilgan;
      // tranzaksiya to'liq bekor bo'ldi, balans ikki marta oshmadi.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const { balanceUzs } = await this.db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { balanceUzs: true },
        });
        return { credited: false, balanceUzs };
      }
      throw e;
    }
  }

  /**
   * Admin tuzatishi (±): bonus, qaytarilgan to'lovni yechish, xato tuzatish.
   * Manfiy summa bo'sh balansdan ko'p bo'lsa — `ok: false`, hech narsa yozilmaydi.
   */
  async adjust(
    userId: string,
    amountUzs: Amount,
    note: string,
  ): Promise<{ ok: boolean; balanceUzs: Prisma.Decimal }> {
    const amount = new Prisma.Decimal(amountUzs);
    if (amount.isZero() || amount.decimalPlaces() > 2) {
      throw new Error(`Noto'g'ri summa: ${amountUzs}`);
    }
    return this.db.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          ...(amount.lt(0) && { balanceUzs: { gte: amount.negated() } }),
        },
        data: { balanceUzs: { increment: amount } },
      });
      const { balanceUzs } = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balanceUzs: true },
      });
      if (updated.count === 0) return { ok: false, balanceUzs };
      await tx.balanceEntry.create({
        data: {
          userId,
          type: 'ADJUSTMENT',
          amountUzs: amount,
          balanceAfterUzs: balanceUzs,
          note,
        },
      });
      return { ok: true, balanceUzs };
    });
  }

  /**
   * E'lon budjeti uchun yechish (tashqi tranzaksiya ichida). Pul yetmasa —
   * `false`: shartli UPDATE, parallel so'rovlar bitta pulni ikki marta sarflay olmaydi.
   */
  async debitForFunding(
    tx: Tx,
    userId: string,
    amountUzs: Amount,
    ref: { operationId: string; adId?: number; note?: string },
  ): Promise<boolean> {
    const amount = toAmount(amountUzs);
    const debited = await tx.user.updateMany({
      where: { id: userId, balanceUzs: { gte: amount } },
      data: { balanceUzs: { decrement: amount } },
    });
    if (debited.count === 0) return false;
    await this.writeEntry(tx, userId, 'AD_FUNDING', amount.negated(), ref);
    return true;
  }

  /** E'londan qaytgan yoki Telegram rad etgan pulni bo'sh balansga qaytarish. */
  async refund(
    tx: Tx,
    userId: string,
    amountUzs: Amount,
    ref: { operationId: string; adId?: number; note?: string },
  ): Promise<void> {
    const amount = new Prisma.Decimal(amountUzs);
    if (amount.lte(0)) return;
    await tx.user.update({
      where: { id: userId },
      data: { balanceUzs: { increment: amount } },
    });
    await this.writeEntry(tx, userId, 'AD_REFUND', amount, ref);
  }

  /**
   * Do'kon xaridi (Stars / Premium / sovg'a) — tashqi tranzaksiya ichida.
   * Pul yetmasa — `false` (shartli UPDATE). Jurnalda (SHOP, buyurtma id) yagona.
   */
  async debitForShop(
    tx: Tx,
    userId: string,
    amountUzs: Amount,
    ref: { orderId: string; note?: string },
  ): Promise<boolean> {
    const amount = toAmount(amountUzs);
    const debited = await tx.user.updateMany({
      where: { id: userId, balanceUzs: { gte: amount } },
      data: { balanceUzs: { decrement: amount } },
    });
    if (debited.count === 0) return false;
    const { balanceUzs } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balanceUzs: true },
    });
    await tx.balanceEntry.create({
      data: {
        userId,
        type: 'SHOP_PURCHASE',
        amountUzs: amount.negated(),
        balanceAfterUzs: balanceUzs,
        source: SHOP_SOURCE,
        externalId: ref.orderId,
        note: ref.note,
      },
    });
    return true;
  }

  /**
   * Yetkazilmagan xarid puli qaytadi — tashqi tranzaksiya ichida. Bitta buyurtma
   * uchun FAQAT BIR MARTA: (SHOP_REFUND, buyurtma id) yagona, ikkinchisi
   * tranzaksiyani yiqitadi (chaqiruvchi holatni shartli o'zgartirib himoyalaydi).
   */
  async refundShop(
    tx: Tx,
    userId: string,
    amountUzs: Amount,
    ref: { orderId: string; note?: string },
  ): Promise<void> {
    const amount = toAmount(amountUzs);
    const { balanceUzs } = await tx.user.update({
      where: { id: userId },
      data: { balanceUzs: { increment: amount } },
      select: { balanceUzs: true },
    });
    await tx.balanceEntry.create({
      data: {
        userId,
        type: 'SHOP_REFUND',
        amountUzs: amount,
        balanceAfterUzs: balanceUzs,
        source: SHOP_REFUND_SOURCE,
        externalId: ref.orderId,
        note: ref.note,
      },
    });
  }

  private async writeEntry(
    tx: Tx,
    userId: string,
    type: 'AD_FUNDING' | 'AD_REFUND',
    amountUzs: Prisma.Decimal,
    ref: { operationId: string; adId?: number; note?: string },
  ) {
    const { balanceUzs } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balanceUzs: true },
    });
    await tx.balanceEntry.create({
      data: {
        userId,
        type,
        amountUzs,
        balanceAfterUzs: balanceUzs,
        adId: ref.adId,
        operationId: ref.operationId,
        note: ref.note,
      },
    });
  }
}
