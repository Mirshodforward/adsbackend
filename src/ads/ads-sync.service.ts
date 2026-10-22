import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramAdsClient } from '../telegram-ads/telegram-ads.client.js';
import type {
  Account,
  Ad as TgAd,
} from '../telegram-ads/telegram-ads.types.js';
import { PricingService } from '../settings/pricing.service.js';
import { AdminAlertsService } from '../telegram-bot/admin-alerts.service.js';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import { toAdRow } from './ad-row.js';
import { FundingService } from './client/funding.service.js';

/** Birinchi sinxronlashda olinadigan tarix. API chegarasi: oraliq ≤ 1000 × 300 s ≈ 83 soat. */
const BACKFILL_SEC = 72 * 3600;
const STATS_RETENTION_MS = 30 * 24 * 3600_000;
const STATS_INTERVAL = 300;
/** Shuncha ketma-ket yiqilgandan keyin adminga xabar. */
const FAILURES_BEFORE_ALERT = 3;
/** Hisobda hech bo'lmaganda shuncha TON tursin (mijoz balanslaridan qat'i nazar). */
const MIN_TREASURY_TON = 5;

interface StatusChange {
  ad: TgAd;
  chatId: bigint;
}

/**
 * Telegram Ads → baza: hisob, e'lonlar va 5 daqiqalik statistika. Har
 * sinxronlashdan keyin javobi kelmay qolgan pul amallari qayta uriniladi va
 * mijoz sarfi so'mda yangilanadi.
 */
@Injectable()
export class AdsSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdsSyncService.name);
  private running = false;

  /** Oxirgi sinxronlashdagi hisob holati — admin sahifasi API'ni har safar chaqirmasin. */
  account: Account | null = null;
  lastSyncAt: Date | null = null;
  private failures = 0;

  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly funding: FundingService,
    private readonly bot: TelegramBotService,
    private readonly alerts: AdminAlertsService,
    private readonly pricing: PricingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    // Qayta ishga tushgandan keyin admin sahifasi 5 daqiqa bo'sh turmasin.
    void this.scheduled();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduled() {
    if (!this.config.get('ADS_SYNC_ENABLED', { infer: true })) return;
    try {
      const result = await this.run();
      if (result && this.failures >= FAILURES_BEFORE_ALERT) {
        void this.alerts.send('✅ Telegram Ads bilan sinxronlash tiklandi.');
      }
      if (result) {
        this.failures = 0;
        this.alerts.clear('sync-failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Sinxronlash yiqildi: ${msg}`);
      this.failures += 1;
      if (this.failures >= FAILURES_BEFORE_ALERT) {
        void this.alerts.send(
          `🚨 Telegram Ads bilan sinxronlash ${this.failures} marta ketma-ket yiqildi: ${msg}\n` +
            `E'lon holatlari, sarf va qoldiq qaytarish yangilanmayapti.`,
          { key: 'sync-failed', everyMs: 2 * 3600_000 },
        );
      }
    }
  }

  /** `null` — oldingi sinxronlash hali tugamagan. */
  async run(): Promise<{ ads: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const account = await this.ads.getCurrentAccount();
      const ads = await this.fetchAllAds();
      await this.sync(ads);
      // Javobi kelmay qolgan va vaqti kelgan (yakunlash) pul amallari, so'ng mijoz sarfi.
      await this.funding.reconcile();
      await this.funding.updateSpend();
      this.account = account;
      this.lastSyncAt = new Date();
      await this.checkTreasury(account);
      return { ads: ads.length };
    } finally {
      this.running = false;
    }
  }

  private async fetchAllAds(): Promise<TgAd[]> {
    const all: TgAd[] = [];
    let offset: string | undefined;
    do {
      const page = await this.ads.getAdsList({ offset, limit: 100 });
      all.push(...page.ads);
      offset = page.next_offset || undefined;
    } while (offset);
    return all;
  }

  private async sync(ads: TgAd[]) {
    const now = Math.floor(Date.now() / 1000);
    const changes: StatusChange[] = [];
    for (let ad of ads) {
      const prev = await this.db.ad.findUnique({
        where: { adId: ad.ad_id },
        select: {
          spentBudget: true,
          status: true,
          clientAd: {
            select: { closedAt: true, user: { select: { telegramId: true } } },
          },
        },
      });
      // Mijoz e'loni moderatsiyaga yuborilmay qolgan bo'lsa — yuboramiz.
      if (
        prev?.clientAd &&
        !prev.clientAd.closedAt &&
        ad.status === 'ready_for_review'
      ) {
        try {
          ad = await this.ads.submitAdForReview({ ad_id: ad.ad_id });
        } catch (e) {
          this.logger.warn(
            `submitAdForReview ${ad.ad_id}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      if (
        prev?.clientAd &&
        !prev.clientAd.closedAt &&
        prev.status !== ad.status
      ) {
        changes.push({ ad, chatId: prev.clientAd.user.telegramId });
      }
      const row = toAdRow(ad);
      await this.db.ad.upsert({
        where: { adId: ad.ad_id },
        create: row,
        update: row,
      });
      // To'xtagan e'londa yangi statistika bo'lmaydi — faqat faol yoki
      // sarfi o'zgarganlar (endigina to'xtaganining oxirgi nuqtalari) uchun so'raymiz.
      if (
        ad.status === 'active' ||
        !prev ||
        prev.spentBudget.toNumber() !== ad.spent_budget
      ) {
        await this.syncStats(ad.ad_id, now);
      }
    }
    await this.db.adStat.deleteMany({
      where: { fromTime: { lt: new Date(Date.now() - STATS_RETENTION_MS) } },
    });
    for (const change of changes) await this.notifyOwner(change);
  }

  /**
   * Platformaning TON hisobi mijoz balanslarini qoplashi kerak: mijozlar bo'sh
   * balansini e'longa aylantirganda Telegram'ga shuncha TON ketadi. Kam bo'lsa,
   * yangi e'lonlar rad etiladi — adminga oldindan xabar.
   */
  private async checkTreasury(account: Account) {
    try {
      const [{ _sum }, pricing] = await Promise.all([
        this.db.user.aggregate({ _sum: { balanceUzs: true } }),
        this.pricing.getPricing(),
      ]);
      const owedUzs = _sum.balanceUzs?.toNumber() ?? 0;
      const needTon =
        pricing.uzsPerTon > 0 ? owedUzs / pricing.uzsPerTon : 0;
      const floor = Math.max(needTon, MIN_TREASURY_TON);
      if (account.remaining_budget < floor) {
        void this.alerts.send(
          `⚠️ Telegram Ads hisobida TON kam: ${account.remaining_budget} TON.\n` +
            `Mijoz balanslari (${Math.round(owedUzs).toLocaleString('ru-RU')} so'm) uchun kamida ${needTon.toFixed(2)} TON kerak, ` +
            `eng kam zaxira — ${MIN_TREASURY_TON} TON. Hisobni to'ldiring, aks holda yangi e'lonlar rad etiladi.`,
          { key: 'ton-low', everyMs: 6 * 3600_000 },
        );
      } else {
        this.alerts.clear('ton-low');
      }
    } catch (e) {
      this.logger.warn(
        `TON zaxirasini tekshirib bo'lmadi: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Mijozga: e'lon moderatsiyadan o'tdi, rad etildi yoki budjeti tugadi. */
  private async notifyOwner({ ad, chatId }: StatusChange) {
    const name = `«${(ad.text || ad.title).replace(/\s+/g, ' ').slice(0, 60)}»`;
    const url = `${this.config.get('FRONTEND_URL', { infer: true })}/dashboard/ads/${ad.ad_id}`;
    const text =
      ad.status === 'active'
        ? `✅ ${name} e'loningiz moderatsiyadan o'tdi va ko'rsatila boshladi.\n${url}`
        : ad.status === 'declined'
          ? `❌ ${name} e'loningiz moderatsiyadan o'tmadi: ${ad.decline_reason?.text ?? "sabab ko'rsatilmagan"}.\nE'lonni yakunlasangiz, pul balansingizga qaytadi: ${url}`
          : ad.status === 'stopped' && ad.remaining_budget === 0
            ? `ℹ️ ${name} e'loningiz budjeti tugadi. Davom ettirish uchun budjet qo'shing: ${url}`
            : null;
    if (text) await this.bot.sendMessage(chatId, text);
  }

  private async syncStats(adId: number, now: number) {
    const last = await this.db.adStat.findFirst({
      where: { adId },
      orderBy: { fromTime: 'desc' },
      select: { fromTime: true },
    });
    // Oxirgi nuqta yozilganda hali to'lmagan bo'lishi mumkin — uni ham qayta olamiz.
    const from = Math.max(
      last ? Math.floor(last.fromTime.getTime() / 1000) : 0,
      now - BACKFILL_SEC,
    );
    const points = await this.ads.getAdStats({
      ad_id: adId,
      from_time: from,
      to_time: now,
      interval: STATS_INTERVAL,
    });
    await this.db.$transaction([
      this.db.adStat.deleteMany({
        where: { adId, fromTime: { gte: new Date(from * 1000) } },
      }),
      this.db.adStat.createMany({
        data: points.map((p) => ({
          adId,
          fromTime: new Date(p.from_time * 1000),
          views: p.views,
          clicks: p.clicks,
          actions: p.actions,
          spent: p.spent_budget,
        })),
      }),
    ]);
  }
}
