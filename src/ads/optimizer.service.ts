import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../common/http.js';
import type { Env } from '../config/env.js';
import type {
  Ad,
  Recommendation,
  RecommendationKind,
  RecommendationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../telegram-ads/telegram-ads.client.js';
import type {
  Account,
  Ad as TgAd,
} from '../telegram-ads/telegram-ads.types.js';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import { toAdRow } from './ad-row.js';
import {
  accountContext,
  COOLDOWN_MS,
  evaluateAd,
  isCoolingDown,
  type AdState,
  type RecommendationDraft,
} from './optimizer/rules.js';

const HOUR = 3600_000;

const KIND_LABEL: Record<RecommendationKind, string> = {
  ADD_BUDGET: "budjet qo'shish",
  PAUSE: "to'xtatish",
  RAISE_CPM: "CPM'ni oshirish",
};

/**
 * Tavsiyalar: qoidalarni ishga tushiradi, admin qarorini Telegram Ads'da
 * bajaradi. Hozircha faqat tavsiya rejimi — pul o'zgaradigan amallarni admin
 * tasdiqlaydi.
 */
@Injectable()
export class OptimizerService {
  private readonly logger = new Logger(OptimizerService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly ads: TelegramAdsClient,
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Faol e'lonlarni qoidalardan o'tkazadi. Qaytaradi: yangi tavsiyalar soni. */
  async evaluate(account: Account): Promise<number> {
    const rows = await this.db.ad.findMany();
    const states = await Promise.all(rows.map((row) => this.stateOf(row)));
    const ctx = accountContext(
      states,
      account.remaining_budget,
      this.config.get('ADS_MAX_CPM', { infer: true }),
    );

    const created: Recommendation[] = [];
    for (const state of states) {
      const drafts = evaluateAd(state, ctx);
      const pending = await this.db.recommendation.findMany({
        where: { adId: state.adId, status: 'PENDING' },
      });

      // Sharoiti yo'qolgan tavsiya (budjet to'ldirildi, e'lon to'xtadi...) — eskirdi.
      const stale = pending.filter(
        (p) => !drafts.some((d) => d.kind === p.kind),
      );
      if (stale.length > 0) {
        await this.db.recommendation.updateMany({
          where: { id: { in: stale.map((s) => s.id) }, status: 'PENDING' },
          data: { status: 'EXPIRED', decidedAt: new Date() },
        });
      }

      const recent = await this.db.recommendation.findMany({
        where: {
          adId: state.adId,
          status: { in: ['DISMISSED', 'FAILED'] },
          decidedAt: { gte: new Date(Date.now() - COOLDOWN_MS.DISMISSED) },
        },
        select: { kind: true, status: true, decidedAt: true },
      });
      for (const draft of drafts) {
        // Shu turdagi tavsiya allaqachon kutilmoqda yoki yaqinda rad etilgan.
        if (pending.some((p) => p.kind === draft.kind)) continue;
        if (isCoolingDown(recent, draft.kind)) continue;
        created.push(await this.create(state.adId, draft));
      }
    }

    if (created.length > 0) await this.notifyAdmins(created, rows);
    return created.length;
  }

  list(status: RecommendationStatus) {
    return this.db.recommendation.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { ad: { select: { title: true, currency: true } } },
    });
  }

  async apply(id: string, adminId: string) {
    const rec = await this.claim(id, 'APPLIED', adminId);

    try {
      // Bazadagi nusxa 5 daqiqagacha eski — qaror hozirgi holat bo'yicha.
      const [current] = await this.ads.getAdsById({ ad_ids: [rec.adId] });
      const stale = staleReason(rec, current);
      if (stale) {
        await this.finish(id, 'EXPIRED', stale);
        fail(stale, 409);
      }

      const updated = await this.execute(rec);
      await this.db.ad.update({
        where: { adId: rec.adId },
        data: toAdRow(updated),
      });
      this.logger.log(`Qo'llandi: ${rec.kind} #${rec.adId} (${id})`);
      return this.db.recommendation.findUniqueOrThrow({ where: { id } });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const code = e instanceof TelegramAdsError ? e.code : 'UNKNOWN';
      this.logger.error(`Qo'llab bo'lmadi: ${rec.kind} #${rec.adId}: ${code}`);
      await this.finish(id, 'FAILED', code);
      fail(`Telegram Ads xatosi: ${code}`, 502);
    }
  }

  async dismiss(id: string, adminId: string) {
    await this.claim(id, 'DISMISSED', adminId);
    return this.db.recommendation.findUniqueOrThrow({ where: { id } });
  }

  /**
   * PENDING'dan chiqarishni bitta so'rov "egallaydi": tugma ikki marta bosilsa
   * ham amal (va pul o'tkazmasi) bir marta bajariladi.
   */
  private async claim(
    id: string,
    status: 'APPLIED' | 'DISMISSED',
    adminId: string,
  ): Promise<Recommendation> {
    const claimed = await this.db.recommendation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedAt: new Date(), decidedById: adminId },
    });
    if (claimed.count === 0) {
      const exists = await this.db.recommendation.count({ where: { id } });
      fail(
        exists ? "Tavsiya allaqachon ko'rib chiqilgan" : 'Tavsiya topilmadi',
        exists ? 409 : 404,
      );
    }
    return this.db.recommendation.findUniqueOrThrow({ where: { id } });
  }

  private finish(id: string, status: RecommendationStatus, error: string) {
    return this.db.recommendation.update({
      where: { id },
      data: { status, error },
    });
  }

  private execute(rec: Recommendation): Promise<TgAd> {
    const change = rec.change as Record<string, number>;
    switch (rec.kind) {
      case 'ADD_BUDGET':
        // idempotency_key — tavsiya id'si: so'rov qayta yuborilsa ham budjet bir marta o'tadi.
        return this.ads.increaseAdBudget({
          ad_id: rec.adId,
          amount: change.amount,
          idempotency_key: rec.id,
        });
      case 'PAUSE':
        return this.ads.editAd({ ad_id: rec.adId, is_paused: true });
      case 'RAISE_CPM':
        return this.ads.editAd({ ad_id: rec.adId, cpm: change.cpm });
    }
  }

  private create(adId: number, draft: RecommendationDraft) {
    return this.db.recommendation.create({
      data: {
        adId,
        kind: draft.kind,
        reason: draft.reason,
        change: draft.change,
        snapshot: draft.snapshot,
      },
    });
  }

  private async stateOf(row: Ad): Promise<AdState> {
    const base = {
      adId: row.adId,
      status: row.status,
      isPaused: row.isPaused,
      actionType: row.actionType,
      currency: row.currency,
      cpm: row.cpm.toNumber(),
      remainingBudget: row.remainingBudget.toNumber(),
      dailyBudgetLimit: row.dailyBudgetLimit?.toNumber() ?? null,
      dailySpent: (row.raw as Partial<TgAd>).daily_spent_budget ?? null,
      views: row.views,
      clicks: row.clicks,
      actions: row.actions,
      spent: row.spentBudget.toNumber(),
    };
    if (row.status !== 'active') {
      return {
        ...base,
        spentLast24h: 0,
        viewsLast6h: 0,
        viewsSame6hYesterday: null,
      };
    }

    const now = Date.now();
    const sum = (from: number, to: number) =>
      this.db.adStat.aggregate({
        where: {
          adId: row.adId,
          fromTime: { gte: new Date(from), lt: new Date(to) },
        },
        _sum: { views: true, spent: true },
      });
    const [day, last6h, yesterday6h, oldest] = await Promise.all([
      sum(now - 24 * HOUR, now),
      sum(now - 6 * HOUR, now),
      sum(now - 30 * HOUR, now - 24 * HOUR),
      this.db.adStat.findFirst({
        where: { adId: row.adId },
        orderBy: { fromTime: 'asc' },
        select: { fromTime: true },
      }),
    ]);
    const hasYesterday =
      !!oldest && oldest.fromTime.getTime() <= now - 30 * HOUR;

    return {
      ...base,
      spentLast24h: day._sum.spent?.toNumber() ?? 0,
      viewsLast6h: last6h._sum.views ?? 0,
      viewsSame6hYesterday: hasYesterday ? (yesterday6h._sum.views ?? 0) : null,
    };
  }

  private async notifyAdmins(created: Recommendation[], ads: Ad[]) {
    const titles = new Map(ads.map((a) => [a.adId, a.title]));
    const lines = created.map(
      (r) =>
        `• #${r.adId} «${titles.get(r.adId)}» — ${KIND_LABEL[r.kind]}\n  ${r.reason}`,
    );
    const url = `${this.config.get('FRONTEND_URL', { infer: true })}/dashboard/ads`;
    const text = `OsonTarget: ${created.length} ta yangi tavsiya\n\n${lines.join('\n\n')}\n\nKo'rib chiqish: ${url}`;

    const admins = await this.db.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { telegramId: true },
    });
    for (const admin of admins)
      await this.bot.sendMessage(admin.telegramId, text);
  }
}

/** Tavsiya berilgandan keyin e'lon o'zgargan bo'lsa — eskirgan, qo'llanmaydi. */
function staleReason(rec: Recommendation, ad: TgAd | undefined): string | null {
  if (!ad) return "E'lon Telegram Ads'da topilmadi";
  const snap = rec.snapshot as { cpm: number; isPaused: boolean };
  if ((ad.is_paused ?? false) !== snap.isPaused) {
    return "E'lon tavsiyadan keyin to'xtatilgan yoki yoqilgan — tavsiya eskirdi";
  }
  if (rec.kind === 'RAISE_CPM' && ad.cpm !== snap.cpm) {
    return "CPM tavsiyadan keyin o'zgargan — tavsiya eskirdi";
  }
  // Budjeti tugab to'xtagan e'longa budjet qo'shish uni qayta yoqadi — bu to'g'ri;
  // boshqa turlar faqat faol e'lon uchun.
  if (
    ad.status === 'declined' ||
    (rec.kind !== 'ADD_BUDGET' && ad.status !== 'active')
  ) {
    return `E'lon holati o'zgargan (${ad.status}) — tavsiya eskirdi`;
  }
  return null;
}
