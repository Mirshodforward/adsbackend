import { Prisma } from '../generated/prisma/client.js';

/** Admin ro'yxatlarida ko'rinadigan e'lon maydonlari. */
export const CLIENT_AD_FIELDS = {
  adId: true,
  title: true,
  text: true,
  promoteUrl: true,
  placement: true,
  status: true,
  isPaused: true,
  actionType: true,
  currency: true,
  cpm: true,
  spentBudget: true,
  remainingBudget: true,
  views: true,
  clicks: true,
  actions: true,
  declineReason: true,
  createdDate: true,
} as const;

interface ClientAdMoney {
  fundedUzs: Prisma.Decimal;
  fundedTon: Prisma.Decimal;
  spentUzs: Prisma.Decimal;
  refundedUzs: Prisma.Decimal;
  closedAt: Date | null;
}

interface AdMoneyFields {
  cpm: Prisma.Decimal;
  spentBudget: Prisma.Decimal;
  remainingBudget: Prisma.Decimal;
}

/**
 * E'lonning pul ko'rsatkichlari so'mda. Mijoz e'loni — o'z kursi bo'yicha
 * (budjet shu kursda sotib olingan); platformaning o'z e'loni — bozor kursida.
 */
export function adMoney(
  ca: ClientAdMoney | null,
  ad: AdMoneyFields,
  marketUzsPerTon: number | null,
) {
  const rate = ca?.fundedTon.gt(0)
    ? ca.fundedUzs.div(ca.fundedTon)
    : marketUzsPerTon
      ? new Prisma.Decimal(marketUzsPerTon)
      : null;
  const uzs = (ton: Prisma.Decimal) =>
    rate ? ton.mul(rate).toDecimalPlaces(0) : null;
  return {
    rateUzsPerTon: rate?.toDecimalPlaces(2) ?? null,
    cpmUzs: uzs(ad.cpm),
    spentUzs: ca ? ca.spentUzs : uzs(ad.spentBudget),
    remainingUzs: ca
      ? ca.fundedUzs.minus(ca.spentUzs).minus(ca.refundedUzs)
      : uzs(ad.remainingBudget),
    fundedUzs: ca?.fundedUzs ?? null,
    refundedUzs: ca?.refundedUzs ?? null,
    closedAt: ca?.closedAt ?? null,
  };
}
