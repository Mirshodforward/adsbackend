import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRICING_KEY = 'pricing';
const RATE_KEY = 'ton_rate';
/** Bundan eski bozor kursi bilan pul amallari bajarilmaydi (qo'lda kurs bo'lmasa). */
const RATE_MAX_AGE_MS = 24 * 3600_000;

export const pricingSchema = z.object({
  /** Mijoz narxi bozor kursidan shuncha foiz yuqori. */
  commissionPercent: z.number().min(0).max(100).default(10),
  minBudgetUzs: z.number().int().positive().default(30_000),
  /** Telegram minimal CPM'ini aniq e'lon qilmaydi — xavfsiz pastki chegara. */
  minCpmTon: z.number().positive().default(0.1),
  /** Bo'lsa — bozor kursi o'rniga ishlatiladi (1 TON necha so'm, komissiyasiz). */
  manualUzsPerTon: z.number().positive().nullable().default(null),
});
export type PricingSettings = z.infer<typeof pricingSchema>;

const rateSchema = z.object({
  uzsPerTon: z.number().positive(),
  tonUsd: z.number().positive(),
  usdUzs: z.number().positive(),
  fetchedAt: z.string(),
});
type MarketRate = z.infer<typeof rateSchema>;

export interface Pricing extends PricingSettings {
  /** Mijoz narxi: 1 TON necha so'm (komissiya bilan). 0 — kurs yo'q. */
  uzsPerTon: number;
  marketUzsPerTon: number | null;
  rateUpdatedAt: string | null;
  /** Kurs eskirgan yoki yo'q — yangi pul amallari bajarilmaydi. */
  stale: boolean;
}

/**
 * Narx: so'm ↔ TON. Bozor kursi har soatda olinadi: TON/USD — Binance,
 * USD/UZS — O'zbekiston Markaziy banki. Admin komissiya va ixtiyoriy qo'lda
 * kurs belgilaydi.
 */
@Injectable()
export class PricingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    void this.scheduledRefresh();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRefresh() {
    // Fon ishlari faqat serverda — testlar va lokal ishlash tashqi API'ga chiqmasin.
    if (!this.config.get('ADS_SYNC_ENABLED', { infer: true })) return;
    try {
      const rate = await this.fetchMarketRate();
      await this.save(RATE_KEY, rate);
      this.logger.log(`Kurs: 1 TON = ${rate.uzsPerTon} so'm`);
    } catch (e) {
      this.logger.warn(
        `Kursni olib bo'lmadi: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async getPricing(): Promise<Pricing> {
    const [settings, rate] = await Promise.all([
      this.settings(),
      this.load(RATE_KEY, rateSchema),
    ]);
    const market = rate?.uzsPerTon ?? null;
    const base = settings.manualUzsPerTon ?? market;
    const fresh =
      settings.manualUzsPerTon !== null ||
      (!!rate && Date.now() - Date.parse(rate.fetchedAt) < RATE_MAX_AGE_MS);
    return {
      ...settings,
      uzsPerTon: base
        ? Math.round(base * (1 + settings.commissionPercent / 100) * 100) / 100
        : 0,
      marketUzsPerTon: market,
      rateUpdatedAt: rate?.fetchedAt ?? null,
      stale: !base || !fresh,
    };
  }

  async settings(): Promise<PricingSettings> {
    return (
      (await this.load(PRICING_KEY, pricingSchema)) ?? pricingSchema.parse({})
    );
  }

  async updateSettings(patch: Partial<PricingSettings>) {
    const next = pricingSchema.parse({ ...(await this.settings()), ...patch });
    await this.save(PRICING_KEY, next);
    return this.getPricing();
  }

  private async fetchMarketRate(): Promise<MarketRate> {
    const get = async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    };
    const [ton, cbu] = await Promise.all([
      get('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT'),
      get('https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/'),
    ]);
    const tonUsd = Number((ton as { price?: string }).price);
    const usdUzs = Number((cbu as { Rate?: string }[])[0]?.Rate);
    if (!(tonUsd > 0) || !(usdUzs > 0)) {
      throw new Error(`kutilmagan javob: TON=${tonUsd}, USD=${usdUzs}`);
    }
    return {
      uzsPerTon: Math.round(tonUsd * usdUzs * 100) / 100,
      tonUsd,
      usdUzs,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async load<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    const row = await this.db.setting.findUnique({ where: { key } });
    const parsed = schema.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  }

  private save(key: string, value: object) {
    return this.db.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
