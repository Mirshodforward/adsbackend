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
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import { toAdRow } from './ad-row.js';
import { FundingService } from './client/funding.service.js';
import { OptimizerService } from './optimizer.service.js';

/** Birinchi sinxronlashda olinadigan tarix. API chegarasi: oraliq ≤ 1000 × 300 s ≈ 83 soat. */
const BACKFILL_SEC = 72 * 3600;
const STATS_RETENTION_MS = 30 * 24 * 3600_000;
const STATS_INTERVAL = 300;

interface StatusChange {
  ad: TgAd;
  chatId: bigint;
}

/**
 * Telegram Ads → baza: hisob, e'lonlar va 5 daqiqalik statistika. Har
 * sinxronlashdan keyin tavsiyalar qayta hisoblanadi.
 */
@Injectable()
export class AdsSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdsSyncService.name);
  private running = false;

  /** Oxirgi sinxronlashdagi hisob holati — admin sahifasi API'ni har safar chaqirmasin. */
  account: Account | null = null;
  lastSyncAt: Date | null = null;

  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly optimizer: OptimizerService,
    private readonly funding: FundingService,
    private readonly bot: TelegramBotService,
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
      if (result?.created) {
        this.logger.log(`Yangi tavsiyalar: ${result.created}`);
      }
    } catch (e) {
      this.logger.error(
        `Sinxronlash yiqildi: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** `null` — oldingi sinxronlash hali tugamagan. */
  async run(): Promise<{ ads: number; created: number } | null> {
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
      const created = await this.optimizer.evaluate(account);
      return { ads: ads.length, created };
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
    for (const ad of ads) {
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
