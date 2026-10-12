import type { RecommendationKind } from '../../generated/prisma/client.js';

/**
 * Optimizator qoidalari — sof funksiyalar: kirish — e'lonning hozirgi holati,
 * chiqish — tavsiyalar. Telegram yoki bazaga murojaat qilmaydi, shuning uchun
 * har bir chegara test bilan mahkamlangan (rules.spec.ts).
 *
 * Asosiy ko'rsatkich — bitta harakat narxi (CPA), CTR emas: e'lonlar botga
 * yo'naltirilgan (`start_bot`), CTR esa aldaydi — 29% CTR'li e'lon 1635
 * bosishdan bitta ham start bermagan (#19, 2026-10).
 */
export const RULES = {
  /** Shundan kam sarflangan e'lon haqida "samarasiz" deyish erta. */
  minSpentForVerdict: 0.5,
  /** CPA hisob medianasidan shuncha baravar qimmat — to'xtatish. */
  pauseCpaMultiplier: 2,
  /** Harakatsiz shuncha bosish — trafik sifatsiz. */
  pauseClicksWithoutActions: 100,
  /** Harakat turi yo'q e'lonlar: CTR medianadan shu ulushdan past — to'xtatish. */
  pauseCtrRatio: 0.5,
  /** Median hisoblashda e'londa kamida shuncha harakat bo'lsin. */
  minActionsForMedian: 5,
  /** Budjet shuncha soatdan kamga yetsa — to'ldirish. */
  budgetHoursLeft: 12,
  /** Necha kunlik sarf qo'shiladi. */
  budgetTopUpDays: 3,
  /** Kechagi shu soatlarga nisbatan ko'rishlar shu ulushdan kam — auksionda yutqazmoqda. */
  underDeliveryRatio: 0.2,
  /** Taqqoslash ishonchli bo'lishi uchun kechagi oynada kamida shuncha ko'rish. */
  underDeliveryMinBaseline: 30,
  /** CPM bir qadamda shuncha oshiriladi. */
  cpmStep: 0.1,
} as const;

/** Qoidalar uchun e'lon holati: Telegram jami ko'rsatkichlari + bizning 5 daqiqalik statistikamiz. */
export interface AdState {
  adId: number;
  status: string;
  isPaused: boolean;
  actionType: string | null;
  currency: string;
  cpm: number;
  remainingBudget: number;
  dailyBudgetLimit: number | null;
  dailySpent: number | null;
  // butun umr bo'yicha
  views: number;
  clicks: number;
  actions: number;
  spent: number;
  // statistikadan
  spentLast24h: number;
  viewsLast6h: number;
  /** Kecha xuddi shu 6 soatdagi ko'rishlar (kunlik ritm — tun — hisobga olinsin). `null` — tarix yetarli emas. */
  viewsSame6hYesterday: number | null;
}

export interface AccountContext {
  /** E'lonlar bo'yicha CPA medianasi (kamida `minActionsForMedian` harakatli). */
  medianCpa: number | null;
  medianCtr: number | null;
  /** Hisobdagi e'lonlarga taqsimlanmagan budjet. */
  availableBudget: number;
  /** RAISE_CPM bundan oshirmaydi. */
  maxCpm: number;
}

export type RecommendationChange =
  { amount: number } | { is_paused: true } | { cpm: number };

export interface RecommendationDraft {
  kind: RecommendationKind;
  reason: string;
  change: RecommendationChange;
  /** Qo'llashdan oldin hozirgi holat bilan solishtiriladi. */
  snapshot: { cpm: number; isPaused: boolean; remainingBudget: number };
}

const fmt = (n: number, digits = 2) => n.toFixed(digits);
const pct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;
const floor2 = (n: number) => Math.floor(n * 100) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Barcha e'lonlar (to'xtaganlari ham) — taqqoslash uchun hisob "normasi". */
export function accountContext(
  ads: AdState[],
  availableBudget: number,
  maxCpm: number,
): AccountContext {
  return {
    medianCpa: median(
      ads
        .filter((a) => a.actionType && a.actions >= RULES.minActionsForMedian)
        .map((a) => a.spent / a.actions),
    ),
    medianCtr: median(
      ads.filter((a) => a.views >= 1000).map((a) => a.clicks / a.views),
    ),
    availableBudget,
    maxCpm,
  };
}

export function evaluateAd(
  ad: AdState,
  ctx: AccountContext,
): RecommendationDraft[] {
  if (ad.status !== 'active' || ad.isPaused) return [];
  const snapshot = {
    cpm: ad.cpm,
    isPaused: ad.isPaused,
    remainingBudget: ad.remainingBudget,
  };

  // Samarasiz e'longa budjet yoki CPM tavsiya qilmaymiz — faqat to'xtatish.
  const pause = whyPause(ad, ctx);
  if (pause) {
    return [
      { kind: 'PAUSE', reason: pause, change: { is_paused: true }, snapshot },
    ];
  }

  const drafts: RecommendationDraft[] = [];
  const topUp = budgetTopUp(ad, ctx);
  if (topUp) drafts.push({ kind: 'ADD_BUDGET', ...topUp, snapshot });
  const raise = cpmRaise(ad, ctx);
  if (raise) drafts.push({ kind: 'RAISE_CPM', ...raise, snapshot });
  return drafts;
}

function whyPause(ad: AdState, ctx: AccountContext): string | null {
  if (ad.spent < RULES.minSpentForVerdict) return null;
  const cur = ad.currency;

  if (ad.actionType) {
    if (ad.actions === 0 && ad.clicks >= RULES.pauseClicksWithoutActions) {
      return `${ad.clicks} ta bosish, lekin birorta ham harakat (${ad.actionType}) yo'q — trafik sifatsiz. Sarflangan: ${fmt(ad.spent)} ${cur}.`;
    }
    if (ad.actions > 0 && ctx.medianCpa) {
      const cpa = ad.spent / ad.actions;
      if (cpa >= ctx.medianCpa * RULES.pauseCpaMultiplier) {
        return `Bitta harakat narxi ${fmt(cpa, 3)} ${cur} — hisob bo'yicha median (${fmt(ctx.medianCpa, 3)} ${cur}) dan ${fmt(cpa / ctx.medianCpa, 1)} baravar qimmat.`;
      }
    }
    return null;
  }

  if (ctx.medianCtr && ad.views > 0) {
    const ctr = ad.clicks / ad.views;
    if (ctr < ctx.medianCtr * RULES.pauseCtrRatio) {
      return `CTR ${pct(ctr)} — hisob medianasi (${pct(ctx.medianCtr)}) ning yarmidan ham past.`;
    }
  }
  return null;
}

function budgetTopUp(
  ad: AdState,
  ctx: AccountContext,
): Pick<RecommendationDraft, 'reason' | 'change'> | null {
  const perHour = ad.spentLast24h / 24;
  if (perHour <= 0) return null;
  const hoursLeft = ad.remainingBudget / perHour;
  if (hoursLeft >= RULES.budgetHoursLeft) return null;

  const wanted = round2(perHour * 24 * RULES.budgetTopUpDays);
  const amount = Math.min(wanted, floor2(ctx.availableBudget));
  if (amount < 0.01) return null;

  const cur = ad.currency;
  const left =
    hoursLeft < 1 ? '1 soatdan kamga' : `~${Math.floor(hoursLeft)} soatga`;
  const limited =
    amount < wanted
      ? ` (hisobda faqat ${fmt(ctx.availableBudget)} ${cur} bor)`
      : '';
  return {
    reason: `Budjet ${left} yetadi — kuniga ${fmt(perHour * 24)} ${cur} sarflanmoqda. ${RULES.budgetTopUpDays} kunlik budjet qo'shish: +${fmt(amount)} ${cur}${limited}.`,
    change: { amount },
  };
}

function cpmRaise(
  ad: AdState,
  ctx: AccountContext,
): Pick<RecommendationDraft, 'reason' | 'change'> | null {
  const baseline = ad.viewsSame6hYesterday;
  if (ad.remainingBudget <= 0 || baseline === null) return null;
  if (baseline < RULES.underDeliveryMinBaseline) return null;
  if (ad.viewsLast6h >= baseline * RULES.underDeliveryRatio) return null;
  // Kunlik limitga yetgan e'lon auksionda yutqazmagan — shunchaki to'xtab turibdi.
  if (
    ad.dailyBudgetLimit &&
    ad.dailySpent !== null &&
    ad.dailySpent >= ad.dailyBudgetLimit * 0.95
  ) {
    return null;
  }

  const cpm = Math.max(
    round2(ad.cpm * (1 + RULES.cpmStep)),
    round2(ad.cpm + 0.01),
  );
  if (cpm > ctx.maxCpm) return null;

  const drop = Math.round((1 - ad.viewsLast6h / baseline) * 100);
  return {
    reason: `Oxirgi 6 soatda ${ad.viewsLast6h} ta ko'rish — kechagi shu vaqtdagi ${baseline} tadan ${drop}% kam. Auksionda yutqazayotgan bo'lishi mumkin: CPM ${fmt(ad.cpm)} → ${fmt(cpm)} ${ad.currency}.`,
    change: { cpm },
  };
}

/**
 * Admin rad etgan tavsiya 24 soat, Telegram xatosi bilan qo'llanmagani 1 soat
 * qayta taklif qilinmaydi — aks holda har 5 daqiqalik sinxronlash uni qaytadan
 * yaratib, botdan yana xabar yuborardi.
 */
export const COOLDOWN_MS = {
  DISMISSED: 24 * 3600_000,
  FAILED: 3600_000,
} as const;

export interface DecidedRecommendation {
  kind: RecommendationKind;
  status: string;
  decidedAt: Date | null;
}

export function isCoolingDown(
  recent: DecidedRecommendation[],
  kind: RecommendationKind,
  now = Date.now(),
): boolean {
  return recent.some(
    (r) =>
      r.kind === kind &&
      r.decidedAt !== null &&
      (r.status === 'DISMISSED' || r.status === 'FAILED') &&
      now - r.decidedAt.getTime() < COOLDOWN_MS[r.status],
  );
}
