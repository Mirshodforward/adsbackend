import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { fail } from '../common/http.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminAlertsService } from '../telegram-bot/admin-alerts.service.js';

const PRICING_KEY = 'pricing';
const RATE_KEY = 'ton_rate';
/** Bundan eski bozor kursi bilan pul amallari bajarilmaydi (qo'lda kurs bo'lmasa). */
const RATE_MAX_AGE_MS = 24 * 3600_000;
/** Kurs shundan eski bo'lib, yangilab bo'lmasa — adminga xabar. */
const RATE_ALERT_AGE_MS = 6 * 3600_000;

/**
 * Platforma sozlamalari — admin panelida o'zgartiriladi, bazada bitta JSON.
 * Mijoz hamma narsani so'mda ko'radi; TON faqat Telegram bilan hisob-kitobda.
 */
export const pricingSchema = z.object({
  /**
   * Xizmat haqi: mijoz narxi bozor kursidan shuncha foiz yuqori. Mijoz e'longa
   * 150 000 so'm ajratsa, Telegram'ga 100 000 so'mlik TON ketadi — farq bizniki.
   */
  commissionPercent: z.number().min(0).max(300).default(50),
  /** Bitta e'longa ajratiladigan eng kam budjet (so'm). */
  minBudgetUzs: z.number().int().positive().max(50_000_000).default(50_000),
  /** Telegram minimal CPM'ini aniq e'lon qilmaydi — xavfsiz pastki chegara (TON). */
  minCpmTon: z.number().positive().default(0.1),
  /** Bo'lsa — bozor kursi o'rniga ishlatiladi (1 TON necha so'm, xizmat haqisiz). */
  manualUzsPerTon: z.number().positive().nullable().default(null),
  /** Balansni to'ldirish: bir martalik summa chegaralari (so'm). */
  topupMinUzs: z.number().int().positive().default(50_000),
  topupMaxUzs: z.number().int().positive().max(100_000_000).default(10_000_000),
  /** Mijoz to'lovga qo'shimcha to'laydigan komissiya (%). 0 — komissiyani biz ko'taramiz. */
  topupFeePercent: z.number().min(0).max(50).default(0),
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
  /** Mijoz narxi: 1 TON necha so'm (xizmat haqi bilan). 0 — kurs yo'q. */
  uzsPerTon: number;
  /** Bozor kursi (Binance × Markaziy bank) — xizmat haqisiz. */
  marketUzsPerTon: number | null;
  /** Bozor kursining tarkibi — admin ko'radi. */
  tonUsd: number | null;
  usdUzs: number | null;
  /** Mijoz uchun 1000 ko'rishning eng kam narxi (so'm). */
  minCpmUzs: number;
  rateUpdatedAt: string | null;
  /** Kurs eskirgan yoki yo'q — yangi pul amallari bajarilmaydi. */
  stale: boolean;
}

/**
 * Narx: so'm ↔ TON. Bozor kursi har soatda olinadi: TON/USD — Binance,
 * USD/UZS — O'zbekiston Markaziy banki. Admin xizmat haqini va ixtiyoriy
 * qo'lda kursni belgilaydi.
 */
@Injectable()
export class PricingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly alerts: AdminAlertsService,
  ) {}

  onApplicationBootstrap() {
    void this.scheduledRefresh();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRefresh() {
    // Fon ishlari faqat serverda — testlar va lokal ishlash tashqi API'ga chiqmasin.
    if (!this.config.get('ADS_SYNC_ENABLED', { infer: true })) return;
    await this.refreshRate();
  }

  /** Bozor kursini hozir yangilash (admin tugmasi ham shuni chaqiradi). */
  async refreshRate(): Promise<MarketRate | null> {
    try {
      const rate = await this.fetchMarketRate();
      await this.save(RATE_KEY, rate);
      this.logger.log(`Kurs: 1 TON = ${rate.uzsPerTon} so'm`);
      this.alerts.clear('rate-stale');
      return rate;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Kursni olib bo'lmadi: ${msg}`);
      // Saqlangan kurs eskirib borayotgan bo'lsa — admin bilsin (24 soatdan keyin sotuv to'xtaydi).
      const saved = await this.load(RATE_KEY, rateSchema);
      const age = saved ? Date.now() - Date.parse(saved.fetchedAt) : Infinity;
      if (age > RATE_ALERT_AGE_MS) {
        void this.alerts.send(
          `⚠️ TON kursini olib bo'lmayapti: ${msg}\n` +
            `Oxirgi kurs ${saved ? Math.round(age / 3600_000) + ' soat oldin' : "hech qachon olinmagan"}. ` +
            `${RATE_MAX_AGE_MS / 3600_000} soatdan keyin yangi e'lonlar to'xtaydi — admin panelda qo'lda kurs qo'yish mumkin.`,
          { key: 'rate-stale', everyMs: 6 * 3600_000 },
        );
      }
      return null;
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
    const uzsPerTon = base
      ? Math.round(base * (1 + settings.commissionPercent / 100) * 100) / 100
      : 0;
    return {
      ...settings,
      uzsPerTon,
      marketUzsPerTon: market,
      tonUsd: rate?.tonUsd ?? null,
      usdUzs: rate?.usdUzs ?? null,
      minCpmUzs: Math.ceil(settings.minCpmTon * uzsPerTon),
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
    // Qo'lda kurs bozor kursidan 2 barobardan ko'p farq qilsa — katta ehtimol
    // xato terilgan (bitta nol). Shunday kurs hamma e'lonni noto'g'ri narxlaydi.
    if (patch.manualUzsPerTon != null) {
      const rate = await this.load(RATE_KEY, rateSchema);
      if (
        rate &&
        (patch.manualUzsPerTon < rate.uzsPerTon / 2 ||
          patch.manualUzsPerTon > rate.uzsPerTon * 2)
      ) {
        fail(
          `Qo'lda kurs (${patch.manualUzsPerTon}) bozor kursidan (${rate.uzsPerTon}) 2 barobardan ko'p farq qiladi — tekshiring`,
        );
      }
    }
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
