import type { Prisma } from '../generated/prisma/client.js';
import type { Ad as TgAd } from '../telegram-ads/telegram-ads.types.js';

/** Telegram Ads javobidagi e'lon → bazadagi `Ad` qatori. */
export function toAdRow(ad: TgAd) {
  return {
    adId: ad.ad_id,
    title: ad.title,
    text: ad.text ?? '',
    promoteUrl: ad.promote_url,
    placement: ad.placement,
    status: ad.status,
    // Maydon kelmasa — e'lon pauzada emas (API ixtiyoriy maydonlarni tashlab yuboradi).
    isPaused: ad.is_paused ?? false,
    actionType: ad.action_type ?? null,
    currency: ad.currency,
    cpm: ad.cpm,
    dailyBudgetLimit: ad.daily_budget_limit ?? null,
    spentBudget: ad.spent_budget,
    remainingBudget: ad.remaining_budget,
    views: ad.views,
    clicks: ad.clicks ?? 0,
    actions: ad.actions,
    declineReason: ad.decline_reason?.text ?? null,
    raw: ad as unknown as Prisma.InputJsonValue,
    createdDate: new Date(ad.created_date * 1000),
  };
}
