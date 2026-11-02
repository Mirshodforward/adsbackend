/**
 * Do'kon narxlari — sof funksiyalar. Hamkor narxi (USDT) × USDT kursi (so'm)
 * × (1 + ustama). Admin ustamani mahsulot bo'yicha belgilaydi.
 */
import { z } from 'zod';

export const SHOP_SETTINGS_KEY = 'shop';

/**
 * Standart ustamalar StarsPaymee bot narxlariga yaqin (2026-11-02, 1 USDT = 12 250):
 * 1⭐ ≈ 220 so'm, Premium 3 oy ≈ 160 000, 15⭐ sovg'a ≈ 4 500 so'm.
 */
export const shopSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  starsMarkupPercent: z.number().min(0).max(300).default(17),
  premiumMarkupPercent: z.number().min(0).max(300).default(9),
  giftMarkupPercent: z.number().min(0).max(300).default(48),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export const STARS_PRESETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const PREMIUM_MONTHS = [3, 6, 12] as const;

/** 1 Star narxi (butun so'm, yuqoriga). */
export function starsUnitUzs(usdtPerStar: number, usdUzs: number, markupPercent: number): number {
  return Math.ceil(round6(usdtPerStar * usdUzs * (1 + markupPercent / 100)));
}

/** Premium va sovg'a narxi — 100 so'mgacha yuqoriga yaxlitlanadi. */
export function packageUzs(usdt: number, usdUzs: number, markupPercent: number): number {
  return Math.ceil(round6(usdt * usdUzs * (1 + markupPercent / 100)) / 100) * 100;
}

/** Suzuvchi nuqta qoldig'i (183.75000000001) yuqoriga yaxlitlashni buzmasin. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Telegram username: `@`, `t.me/` olib tashlanadi; 3–32 belgi, harf bilan boshlanadi. */
export function normalizeUsername(raw: string): string | null {
  const v = raw
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0];
  return /^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(v) ? v : null;
}
