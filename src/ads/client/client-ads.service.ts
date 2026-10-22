import { Injectable } from '@nestjs/common';
import { fail } from '../../common/http.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PricingService } from '../../settings/pricing.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../../telegram-ads/telegram-ads.client.js';
import { toAdRow } from '../ad-row.js';
import {
  buildAdRequest,
  formatUzs,
  normalizeUsername,
  type ClientAdInput,
} from './ad-request.js';
import { AdsOptionsService } from './ads-options.service.js';
import { FundingService } from './funding.service.js';
import { tgErrorMessage } from './tg-errors.js';

/** Qo'shimcha budjet uchun pastki chegara (so'm). */
const MIN_TOP_UP_UZS = 10_000;

const AD_FIELDS = {
  title: true,
  text: true,
  promoteUrl: true,
  placement: true,
  status: true,
  isPaused: true,
  cpm: true,
  currency: true,
  views: true,
  clicks: true,
  actions: true,
  actionType: true,
  remainingBudget: true,
  declineReason: true,
  createdDate: true,
} as const;

@Injectable()
export class ClientAdsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly funding: FundingService,
    private readonly pricing: PricingService,
    private readonly options: AdsOptionsService,
  ) {}

  /**
   * E'lon yaratish menyusi. Narx faqat so'mda: kurs, xizmat haqi va TON
   * qiymatlari mijozga yuborilmaydi — ulardan marjani hisoblab bo'lardi.
   */
  async getOptions(userId: string) {
    const [dictionaries, pricing, recommendedCpmUzs, user] = await Promise.all([
      this.options.dictionaries(),
      this.pricing.getPricing(),
      this.options.recommendedCpmUzs(),
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balanceUzs: true },
      }),
    ]);
    return {
      ...dictionaries,
      pricing: {
        minBudgetUzs: pricing.minBudgetUzs,
        minCpmUzs: pricing.minCpmUzs,
        stale: pricing.stale,
      },
      recommendedCpmUzs,
      balanceUzs: user.balanceUzs,
    };
  }

  /** Kanal/botni username bo'yicha topadi — menyuda nomi va rasmi ko'rinsin. */
  async resolve(kind: 'channel' | 'bot', raw: string) {
    const name = normalizeUsername(raw);
    if (!name) fail("Username noto'g'ri — @username ko'rinishida kiriting");
    try {
      return kind === 'channel'
        ? await this.ads.getTargetChannel({ channel_id: name })
        : await this.ads.getTargetBot({ bot_id: name });
    } catch (e) {
      if (e instanceof TelegramAdsError) {
        fail(
          kind === 'channel'
            ? `${name} kanali topilmadi yoki unda reklama ko'rsatilmaydi`
            : `${name} boti topilmadi yoki unda reklama ko'rsatilmaydi`,
          404,
        );
      }
      throw e;
    }
  }

  async create(userId: string, input: ClientAdInput) {
    const [pricing, user] = await Promise.all([
      this.pricing.getPricing(),
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { clientId: true },
      }),
    ]);
    const built = buildAdRequest(input, pricing, user.clientId);
    if (!built.ok) fail(built.error);

    const op = await this.funding.start(
      userId,
      'CREATE_AD',
      { uzs: built.amountUzs, ton: built.amountTon },
      built.request,
    );
    const result = await this.funding.execute(op);
    if (result.status === 'FAILED') {
      fail(
        `${tgErrorMessage(result.error)}. Pul balansingizga qaytarildi.`,
        422,
      );
    }
    // PENDING — Telegram javob bermadi; sinxronlash xuddi shu kalit bilan yakunlaydi.
    return { status: result.status, adId: result.adId };
  }

  async list(userId: string) {
    const [clientAds, pending] = await Promise.all([
      this.db.clientAd.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { ad: { select: AD_FIELDS } },
      }),
      this.db.fundingOperation.findMany({
        where: { userId, status: 'PENDING' },
        select: {
          id: true,
          kind: true,
          adId: true,
          amountUzs: true,
          createdAt: true,
        },
      }),
    ]);

    const since = new Date(Date.now() - 24 * 3600_000);
    const day = await this.db.adStat.groupBy({
      by: ['adId'],
      where: {
        adId: { in: clientAds.map((c) => c.adId) },
        fromTime: { gte: since },
      },
      _sum: { views: true, clicks: true, actions: true },
    });
    const last24h = new Map(day.map((d) => [d.adId, d._sum]));

    return {
      ads: clientAds.map((ca) => ({
        ...this.view(ca),
        last24h: {
          views: last24h.get(ca.adId)?.views ?? 0,
          clicks: last24h.get(ca.adId)?.clicks ?? 0,
          actions: last24h.get(ca.adId)?.actions ?? 0,
        },
        closing: pending.some(
          (p) => p.kind === 'CLOSE_AD' && p.adId === ca.adId,
        ),
      })),
      /** Telegram javobi kutilayotgan yangi e'lonlar (pul yechilgan). */
      pending: pending.filter((p) => p.kind === 'CREATE_AD'),
    };
  }

  async detail(userId: string, adId: number) {
    const ca = await this.db.clientAd.findFirst({
      where: { adId, userId },
      include: { ad: { select: { ...AD_FIELDS, raw: true } } },
    });
    if (!ca) fail("E'lon topilmadi", 404);

    // Toshkent kuni bo'yicha oxirgi 14 kun.
    const daily = await this.db.$queryRaw<
      {
        day: Date;
        views: bigint;
        clicks: bigint;
        actions: bigint;
        spent: Prisma.Decimal;
      }[]
    >`
      SELECT date_trunc('day', "fromTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent') AS day,
             sum(views) AS views, sum(clicks) AS clicks, sum(actions) AS actions, sum(spent) AS spent
      FROM "AdStat"
      WHERE "adId" = ${adId} AND "fromTime" >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`;
    const rate = ca.fundedTon.gt(0) ? ca.fundedUzs.div(ca.fundedTon) : null;

    const { raw, ...ad } = ca.ad;
    const closing = await this.db.fundingOperation.count({
      where: { adId, kind: 'CLOSE_AD', status: 'PENDING' },
    });
    return {
      ...this.view({ ...ca, ad }),
      target: (raw as { target?: unknown }).target ?? null,
      closing: closing > 0,
      daily: daily.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        views: Number(d.views),
        clicks: Number(d.clicks),
        actions: Number(d.actions),
        spentUzs: rate
          ? Number(new Prisma.Decimal(d.spent).mul(rate).toFixed(0))
          : 0,
      })),
    };
  }

  async setPaused(userId: string, adId: number, paused: boolean) {
    await this.ownOpen(userId, adId);
    try {
      const ad = await this.ads.editAd({ ad_id: adId, is_paused: paused });
      await this.db.ad.update({ where: { adId }, data: toAdRow(ad) });
    } catch (e) {
      if (e instanceof TelegramAdsError)
        fail(tgErrorMessage(e.code), 502);
      throw e;
    }
    return this.detail(userId, adId);
  }

  async addBudget(userId: string, adId: number, amountUzs: number) {
    const ca = await this.ownOpen(userId, adId);
    if (ca.ad.status === 'declined') {
      fail(
        "Rad etilgan e'longa budjet qo'shib bo'lmaydi — uni yakunlang yoki yangisini yarating",
      );
    }
    if (amountUzs < MIN_TOP_UP_UZS) {
      fail(`Kamida ${formatUzs(MIN_TOP_UP_UZS)} so'm qo'shing`);
    }
    const pricing = await this.pricing.getPricing();
    if (pricing.stale)
      fail(
        "Valyuta kursi hozircha yangilanmagan — birozdan so'ng urinib ko'ring",
      );
    // increaseAdBudget summasi 5 xonagacha yaxlitlanadi — pastga, mijozga zarar bo'lmasin.
    const ton = Math.floor((amountUzs / pricing.uzsPerTon) * 1e5) / 1e5;

    const op = await this.funding.start(
      userId,
      'ADD_BUDGET',
      { uzs: amountUzs, ton },
      {},
      adId,
    );
    const result = await this.funding.execute(op);
    if (result.status === 'FAILED') {
      fail(
        `${tgErrorMessage(result.error)}. Pul balansingizga qaytarildi.`,
        422,
      );
    }
    return this.detail(userId, adId);
  }

  /**
   * 1000 ko'rish narxini o'zgartirish. So'm → TON e'lonning o'z kursi bo'yicha
   * (budjet shu kursda sotib olingan) — mijoz ko'rgan so'm narxi bilan mos keladi.
   */
  async setCpm(userId: string, adId: number, cpmUzs: number) {
    const ca = await this.ownOpen(userId, adId);
    if (ca.ad.status === 'declined') {
      fail("Rad etilgan e'lonni o'zgartirib bo'lmaydi — yangisini yarating");
    }
    const pricing = await this.pricing.getPricing();
    const rate = ca.fundedTon.gt(0)
      ? ca.fundedUzs.div(ca.fundedTon).toNumber()
      : pricing.uzsPerTon;
    if (!(rate > 0)) {
      fail(
        "Valyuta kursi hozircha yangilanmagan — birozdan so'ng urinib ko'ring",
      );
    }
    const cpm = Math.round((cpmUzs / rate) * 100) / 100;
    if (cpm < pricing.minCpmTon) {
      fail(
        `1000 ko'rish narxi kamida ${formatUzs(pricing.minCpmTon * rate)} so'm bo'lishi kerak`,
      );
    }
    try {
      const ad = await this.ads.editAd({ ad_id: adId, cpm });
      await this.db.ad.update({ where: { adId }, data: toAdRow(ad) });
    } catch (e) {
      if (e instanceof TelegramAdsError)
        fail(tgErrorMessage(e.code), 502);
      throw e;
    }
    return this.detail(userId, adId);
  }

  /** E'lonni to'xtatadi; ishlatilmagan qoldiq ~10 daqiqadan keyin balansga qaytadi. */
  async close(userId: string, adId: number) {
    const ca = await this.ownOpen(userId, adId);
    await this.finish(ca);
    return this.detail(userId, adId);
  }

  /** Admin: istalgan mijoz e'lonini yakunlash (qoldiq egasiga qaytadi). */
  async closeAsAdmin(adId: number) {
    const ca = await this.db.clientAd.findUnique({
      where: { adId },
      include: { ad: { select: { status: true, isPaused: true } } },
    });
    if (!ca) fail("Bu e'lon mijozniki emas — platformaning o'z e'loni", 404);
    if (ca.closedAt) fail("E'lon allaqachon yakunlangan", 409);
    await this.finish(ca);
  }

  private async finish(ca: {
    adId: number;
    userId: string;
    ad: { status: string; isPaused: boolean };
  }) {
    const pending = await this.db.fundingOperation.count({
      where: { adId: ca.adId, status: 'PENDING' },
    });
    if (pending)
      fail(
        "Bu e'lon bo'yicha amal hali yakunlanmagan — birozdan so'ng urinib ko'ring",
        409,
      );

    if (!ca.ad.isPaused && ca.ad.status !== 'declined') {
      try {
        const ad = await this.ads.editAd({ ad_id: ca.adId, is_paused: true });
        await this.db.ad.update({ where: { adId: ca.adId }, data: toAdRow(ad) });
      } catch (e) {
        if (e instanceof TelegramAdsError)
          fail(tgErrorMessage(e.code), 502);
        throw e;
      }
    }
    await this.funding.scheduleClose(ca.userId, ca.adId);
  }

  private async ownOpen(userId: string, adId: number) {
    const ca = await this.db.clientAd.findFirst({
      where: { adId, userId },
      include: { ad: { select: { status: true, isPaused: true } } },
    });
    if (!ca) fail("E'lon topilmadi", 404);
    if (ca.closedAt) fail("E'lon yakunlangan", 409);
    // Yakunlash navbatda turganda davom ettirish/budjet/narx — Telegram'da
    // qoldiqni qaytarib bo'lmay qoladi (10 daqiqa nofaollik qoidasi).
    const closing = await this.db.fundingOperation.count({
      where: { adId, kind: 'CLOSE_AD', status: 'PENDING' },
    });
    if (closing) fail("E'lon yakunlanmoqda — o'zgartirib bo'lmaydi", 409);
    return ca;
  }

  private view(ca: {
    adId: number;
    fundedUzs: Prisma.Decimal;
    fundedTon: Prisma.Decimal;
    spentUzs: Prisma.Decimal;
    refundedUzs: Prisma.Decimal;
    closedAt: Date | null;
    createdAt: Date;
    ad: Record<string, unknown>;
  }) {
    // TON qiymatlari (cpm, qoldiq, valyuta) mijozga chiqmaydi: so'mdagi narx
    // bilan solishtirib, kursni va xizmat haqini hisoblab bo'lardi.
    const { cpm, currency: _currency, remainingBudget: _remaining, ...ad } =
      ca.ad;
    return {
      adId: ca.adId,
      ...ad,
      fundedUzs: ca.fundedUzs,
      spentUzs: ca.spentUzs,
      refundedUzs: ca.refundedUzs,
      /** 1000 ko'rish narxi so'mda — e'lonning o'rtacha kursi bo'yicha. */
      cpmUzs: ca.fundedTon.gt(0)
        ? new Prisma.Decimal(String(cpm))
            .mul(ca.fundedUzs.div(ca.fundedTon))
            .toDecimalPlaces(0)
        : null,
      /** E'londa qolgan (hali sarflanmagan) pul. */
      heldUzs: ca.fundedUzs.minus(ca.spentUzs).minus(ca.refundedUzs),
      closedAt: ca.closedAt,
    };
  }
}
