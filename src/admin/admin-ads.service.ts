import { Injectable } from '@nestjs/common';
import { toAdRow } from '../ads/ad-row.js';
import { AdsSyncService } from '../ads/ads-sync.service.js';
import { ClientAdsService } from '../ads/client/client-ads.service.js';
import { fail } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService } from '../settings/pricing.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../telegram-ads/telegram-ads.client.js';
import { adMoney } from './ad-money.js';

/** Admin: platforma hisobidagi barcha e'lonlar (mijozlarniki va o'zimizniki). */
@Injectable()
export class AdminAdsService {
  constructor(
    private readonly db: PrismaService,
    private readonly sync: AdsSyncService,
    private readonly ads: TelegramAdsClient,
    private readonly clientAds: ClientAdsService,
    private readonly pricing: PricingService,
  ) {}

  async list() {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [ads, day, pricing] = await Promise.all([
      this.db.ad.findMany({
        orderBy: { adId: 'desc' },
        omit: { raw: true },
        include: {
          clientAd: {
            include: {
              user: {
                select: {
                  id: true,
                  clientId: true,
                  firstName: true,
                  lastName: true,
                  username: true,
                },
              },
            },
          },
        },
      }),
      this.db.adStat.groupBy({
        by: ['adId'],
        where: { fromTime: { gte: since } },
        _sum: { views: true, clicks: true, actions: true, spent: true },
      }),
      this.pricing.getPricing(),
    ]);
    const last24h = new Map(day.map((d) => [d.adId, d._sum]));
    const market = pricing.marketUzsPerTon;
    const account = this.sync.account;
    const toUzs = (ton: number) => (market ? Math.round(ton * market) : null);

    return {
      account: account && {
        currency: account.currency,
        remainingTon: account.remaining_budget,
        adsBudgetTon: account.ads_budget,
        spentTon: account.spent_budget,
        remainingUzs: toUzs(account.remaining_budget),
        adsBudgetUzs: toUzs(account.ads_budget),
        spentUzs: toUzs(account.spent_budget),
      },
      marketUzsPerTon: market,
      uzsPerTon: pricing.uzsPerTon,
      lastSyncAt: this.sync.lastSyncAt,
      ads: ads.map(({ clientAd, ...ad }) => {
        const d = last24h.get(ad.adId);
        const money = adMoney(clientAd, ad, market);
        return {
          ...ad,
          ...money,
          owner: clientAd?.user ?? null,
          last24h: {
            views: d?.views ?? 0,
            clicks: d?.clicks ?? 0,
            actions: d?.actions ?? 0,
            spentTon: d?.spent?.toNumber() ?? 0,
            spentUzs:
              d?.spent && money.rateUzsPerTon
                ? d.spent.mul(money.rateUzsPerTon).toDecimalPlaces(0)
                : null,
          },
        };
      }),
    };
  }

  async setPaused(adId: number, paused: boolean) {
    const exists = await this.db.ad.findUnique({
      where: { adId },
      select: { adId: true },
    });
    if (!exists) fail("E'lon topilmadi", 404);
    try {
      const ad = await this.ads.editAd({ ad_id: adId, is_paused: paused });
      return this.db.ad.update({
        where: { adId },
        data: toAdRow(ad),
        omit: { raw: true },
      });
    } catch (e) {
      if (e instanceof TelegramAdsError)
        fail(`Telegram xatosi: ${e.code}`, 502);
      throw e;
    }
  }

  /** Mijoz e'lonini yakunlash — qoldiq ~10 daqiqada egasining balansiga qaytadi. */
  async close(adId: number) {
    await this.clientAds.closeAsAdmin(adId);
    return { ok: true };
  }

  /** Hozir sinxronlash. */
  async syncNow() {
    const result = await this.sync.run();
    if (!result)
      fail("Sinxronlash allaqachon ketmoqda — birozdan so'ng yangilang", 409);
    return result;
  }
}
