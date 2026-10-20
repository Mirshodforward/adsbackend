import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PricingService } from '../../settings/pricing.service.js';
import { TelegramAdsClient } from '../../telegram-ads/telegram-ads.client.js';
import type {
  TargetCountry,
  TargetLanguage,
  TargetTopic,
} from '../../telegram-ads/telegram-ads.types.js';

const CACHE_MS = 24 * 3600_000;
/** Hisobda shu joylashuvda e'lon bo'lmasa — tavsiya etilgan CPM (TON). */
const DEFAULT_CPM_TON = 0.2;
const PLACEMENTS = ['channel_post', 'bot_banner', 'search_result'] as const;
type Placement = (typeof PLACEMENTS)[number];

export interface Dictionaries {
  topics: TargetTopic[];
  languages: TargetLanguage[];
  countries: TargetCountry[];
}

/** E'lon yaratish menyusi uchun lug'atlar (sutkada bir marta Telegram'dan) va CPM tavsiyasi. */
@Injectable()
export class AdsOptionsService {
  private cache: { at: number; data: Dictionaries } | null = null;

  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly pricing: PricingService,
  ) {}

  async dictionaries(): Promise<Dictionaries> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.data;
    }
    const [topics, languages, countries] = await Promise.all([
      this.ads.getTargetTopicsList(),
      this.ads.getTargetLanguagesList(),
      this.ads.getTargetCountriesList(),
    ]);
    this.cache = { at: Date.now(), data: { topics, languages, countries } };
    return this.cache.data;
  }

  /** Hisobdagi e'lonlar CPM medianasi — joylashuv bo'yicha (TON). */
  async recommendedCpmTon(): Promise<Record<Placement, number>> {
    const ads = await this.db.ad.findMany({
      select: { placement: true, cpm: true },
    });
    const result = {} as Record<Placement, number>;
    for (const placement of PLACEMENTS) {
      const cpms = ads
        .filter((a) => a.placement === placement)
        .map((a) => a.cpm.toNumber())
        .sort((a, b) => a - b);
      result[placement] = cpms.length
        ? cpms[Math.floor(cpms.length / 2)]
        : DEFAULT_CPM_TON;
    }
    return result;
  }

  /**
   * Tavsiya etilgan 1000 ko'rish narxi mijoz kursida (so'm), 100 ga yaxlitlangan
   * va minimal CPM'dan kam emas. Kurs yo'q bo'lsa — `null`.
   */
  async recommendedCpmUzs(): Promise<Record<Placement, number> | null> {
    const [ton, pricing] = await Promise.all([
      this.recommendedCpmTon(),
      this.pricing.getPricing(),
    ]);
    if (pricing.uzsPerTon <= 0) return null;
    const result = {} as Record<Placement, number>;
    for (const placement of PLACEMENTS) {
      const uzs = Math.max(ton[placement] * pricing.uzsPerTon, pricing.minCpmUzs);
      result[placement] = Math.ceil(uzs / 100) * 100;
    }
    return result;
  }
}
