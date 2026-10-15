import { Injectable } from '@nestjs/common';
import { AdsSyncService } from '../ads/ads-sync.service.js';
import { BalanceService } from '../balance/balance.service.js';
import { fail } from '../common/http.js';
import {
  Prisma,
  type FundingStatus,
  type Role,
  type TopupStatus,
} from '../generated/prisma/client.js';
import { TopupsService } from '../payments/topups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService } from '../settings/pricing.service.js';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service.js';
import { adMoney, CLIENT_AD_FIELDS } from './ad-money.js';

const PAGE_SIZE = 50;
const zero = new Prisma.Decimal(0);
const sum = (v: Prisma.Decimal | null | undefined) => v ?? zero;

/** 30000 → "30 000" (bot xabari uchun). */
const fmt = (n: number | Prisma.Decimal) =>
  String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const USER_FIELDS = {
  id: true,
  clientId: true,
  telegramId: true,
  firstName: true,
  lastName: true,
  username: true,
  photoUrl: true,
  role: true,
  isActive: true,
  balanceUzs: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Kun va oy boshi — jarayon TZ'si Toshkent (ecosystem.config.cjs). */
function periodStarts() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const month = new Date(day);
  month.setDate(1);
  return { day, month };
}

/** Admin paneli: mijozlar, pul va to'lovlar bo'yicha boshqaruv. */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly balance: BalanceService,
    private readonly pricing: PricingService,
    private readonly sync: AdsSyncService,
    private readonly topups: TopupsService,
    private readonly bot: TelegramBotService,
  ) {}

  /** Bosh sahifa: platforma holati bir qarashda. */
  async overview() {
    const { day, month } = periodStarts();
    const week = new Date(Date.now() - 7 * 86_400_000);
    const paid = (since?: Date) =>
      this.db.topup.aggregate({
        where: { status: 'PAID', ...(since && { paidAt: { gte: since } }) },
        _sum: { creditUzs: true },
        _count: true,
      });

    const [
      pricing,
      usersTotal,
      usersBlocked,
      usersNew7d,
      balances,
      adsAgg,
      adsByStatus,
      pendingFunding,
      failedFunding,
      pendingTopups,
      topupsToday,
      topupsMonth,
      topupsTotal,
      recentTopups,
      recentUsers,
    ] = await Promise.all([
      this.pricing.getPricing(),
      this.db.user.count(),
      this.db.user.count({ where: { isActive: false } }),
      this.db.user.count({ where: { createdAt: { gte: week } } }),
      this.db.user.aggregate({ _sum: { balanceUzs: true } }),
      this.db.clientAd.aggregate({
        _sum: { fundedUzs: true, spentUzs: true, refundedUzs: true, fundedTon: true },
        _count: true,
      }),
      this.db.ad.groupBy({
        by: ['status'],
        where: { clientAd: { is: { closedAt: null } } },
        _count: true,
      }),
      this.db.fundingOperation.aggregate({
        where: { status: 'PENDING', kind: { in: ['CREATE_AD', 'ADD_BUDGET'] } },
        _sum: { amountUzs: true },
        _count: true,
      }),
      this.db.fundingOperation.count({ where: { status: 'FAILED' } }),
      this.db.topup.count({
        where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      }),
      paid(day),
      paid(month),
      paid(),
      this.db.topup.findMany({
        where: { status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take: 8,
        select: {
          id: true,
          method: true,
          creditUzs: true,
          paidAt: true,
          user: { select: { id: true, clientId: true, firstName: true } },
        },
      }),
      this.db.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: USER_FIELDS,
      }),
    ]);

    const account = this.sync.account;
    const market = pricing.marketUzsPerTon;
    const toUzs = (ton: number) =>
      market ? Math.round(ton * market) : null;
    const inAds = sum(adsAgg._sum.fundedUzs)
      .minus(sum(adsAgg._sum.spentUzs))
      .minus(sum(adsAgg._sum.refundedUzs))
      .plus(sum(pendingFunding._sum.amountUzs));
    const statusCount = (s: string) =>
      adsByStatus.find((r) => r.status === s)?._count ?? 0;

    return {
      pricing,
      lastSyncAt: this.sync.lastSyncAt,
      /** Platformaning Telegram Ads hisobi — TON va bozor kursidagi so'm qiymati. */
      account: account && {
        currency: account.currency,
        remainingTon: account.remaining_budget,
        adsBudgetTon: account.ads_budget,
        spentTon: account.spent_budget,
        remainingUzs: toUzs(account.remaining_budget),
        adsBudgetUzs: toUzs(account.ads_budget),
        spentUzs: toUzs(account.spent_budget),
      },
      clients: {
        total: usersTotal,
        blocked: usersBlocked,
        new7d: usersNew7d,
      },
      money: {
        /** Mijozlarning bo'sh balanslari — bizning majburiyatimiz. */
        freeUzs: sum(balances._sum.balanceUzs),
        /** E'lonlarda turgan, hali sarflanmagan pul. */
        inAdsUzs: inAds,
        /** Mijozlar reklamaga sarflagani (xizmat haqi bilan) — daromad. */
        spentUzs: sum(adsAgg._sum.spentUzs),
        topupsTodayUzs: sum(topupsToday._sum.creditUzs),
        topupsTodayCount: topupsToday._count,
        topupsMonthUzs: sum(topupsMonth._sum.creditUzs),
        topupsMonthCount: topupsMonth._count,
        topupsTotalUzs: sum(topupsTotal._sum.creditUzs),
        topupsTotalCount: topupsTotal._count,
      },
      ads: {
        total: adsAgg._count,
        active: statusCount('active'),
        inReview: statusCount('in_review') + statusCount('ready_for_review'),
        declined: statusCount('declined'),
        stopped: statusCount('stopped'),
      },
      attention: {
        pendingFunding: pendingFunding._count,
        failedFunding,
        pendingTopups,
      },
      recentTopups,
      recentUsers: recentUsers.map((u) => ({
        ...u,
        telegramId: u.telegramId.toString(), // BigInt JSON'ga sig'maydi
      })),
    };
  }

  async users(q: string, page: number) {
    const query = q.trim().replace(/^@/, '');
    const where: Prisma.UserWhereInput = query
      ? {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { username: { contains: query, mode: 'insensitive' } },
            ...(/^\d{1,9}$/.test(query) ? [{ clientId: Number(query) }] : []),
            ...(/^\d{1,19}$/.test(query)
              ? [{ telegramId: BigInt(query) }]
              : []),
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      this.db.user.count({ where }),
      this.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: USER_FIELDS,
      }),
    ]);
    const ids = users.map((u) => u.id);
    const agg = ids.length
      ? await this.db.clientAd.groupBy({
          by: ['userId'],
          where: { userId: { in: ids } },
          _sum: { fundedUzs: true, spentUzs: true, refundedUzs: true },
          _count: true,
        })
      : [];
    const byUser = new Map(agg.map((a) => [a.userId, a]));

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      users: users.map((u) => {
        const a = byUser.get(u.id);
        return {
          ...u,
          telegramId: u.telegramId.toString(),
          adsCount: a?._count ?? 0,
          inAdsUzs: a
            ? sum(a._sum.fundedUzs)
                .minus(sum(a._sum.spentUzs))
                .minus(sum(a._sum.refundedUzs))
            : zero,
          spentUzs: sum(a?._sum.spentUzs),
        };
      }),
    };
  }

  async user(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        ...USER_FIELDS,
        _count: {
          select: {
            sessions: {
              where: { revokedAt: null, expiresAt: { gt: new Date() } },
            },
          },
        },
      },
    });
    if (!user) fail('Mijoz topilmadi', 404);

    const [ads, entries, topups, funding, pending] = await Promise.all([
      this.db.clientAd.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        include: { ad: { select: CLIENT_AD_FIELDS } },
      }),
      this.db.balanceEntry.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.topup.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.fundingOperation.findMany({
        where: { userId: id, status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.fundingOperation.aggregate({
        where: {
          userId: id,
          status: 'PENDING',
          kind: { in: ['CREATE_AD', 'ADD_BUDGET'] },
        },
        _sum: { amountUzs: true },
      }),
    ]);

    const inAds = ads
      .reduce(
        (acc, ca) =>
          acc.plus(ca.fundedUzs).minus(ca.spentUzs).minus(ca.refundedUzs),
        zero,
      )
      .plus(sum(pending._sum.amountUzs));
    const { _count, ...rest } = user;

    return {
      user: {
        ...rest,
        telegramId: user.telegramId.toString(),
        activeSessions: _count.sessions,
      },
      balance: {
        freeUzs: user.balanceUzs,
        inAdsUzs: inAds,
        totalUzs: user.balanceUzs.plus(inAds),
        spentUzs: ads.reduce((acc, ca) => acc.plus(ca.spentUzs), zero),
      },
      ads: ads.map((ca) => ({ ...ca.ad, ...adMoney(ca, ca.ad, null) })),
      entries,
      topups,
      funding,
    };
  }

  /** Balansni qo'lda tuzatish (±). Mijozga bot orqali xabar boradi. */
  async adjust(
    adminId: string,
    userId: string,
    amountUzs: number,
    note: string,
  ) {
    const [admin, user] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: adminId },
        select: { firstName: true },
      }),
      this.db.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      }),
    ]);
    if (!user) fail('Mijoz topilmadi', 404);

    const result = await this.balance.adjust(
      userId,
      amountUzs,
      `${note} — admin ${admin.firstName}`,
    );
    if (!result.ok) {
      fail("Mijozning bo'sh balansi bundan kam — yechib bo'lmaydi", 409);
    }
    void this.bot.sendMessage(
      user.telegramId,
      amountUzs > 0
        ? `💰 Balansingizga +${fmt(amountUzs)} so'm qo'shildi: ${note}.\nBo'sh balans: ${fmt(result.balanceUzs)} so'm`
        : `ℹ️ Balansingizdan ${fmt(-amountUzs)} so'm yechildi: ${note}.\nBo'sh balans: ${fmt(result.balanceUzs)} so'm`,
    );
    return { balanceUzs: result.balanceUzs };
  }

  /** Bloklash barcha sessiyalarni yopadi — mijoz darhol chiqib ketadi. */
  async setActive(adminId: string, userId: string, isActive: boolean) {
    if (adminId === userId) fail("O'zingizni bloklay olmaysiz");
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) fail('Mijoz topilmadi', 404);
    await this.db.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) {
      await this.db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { isActive };
  }

  async setRole(adminId: string, userId: string, role: Role) {
    if (adminId === userId) fail("O'z rolingizni o'zgartira olmaysiz");
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) fail('Mijoz topilmadi', 404);
    await this.db.user.update({ where: { id: userId }, data: { role } });
    return { role };
  }

  async topupsList(status: TopupStatus | undefined, page: number) {
    const where: Prisma.TopupWhereInput = status ? { status } : {};
    const [total, topups] = await Promise.all([
      this.db.topup.count({ where }),
      this.db.topup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: {
            select: {
              id: true,
              clientId: true,
              firstName: true,
              username: true,
            },
          },
        },
      }),
    ]);
    return { total, page, pageSize: PAGE_SIZE, topups };
  }

  /** Webhook kelmagan to'ldirishni Paylinker'dan qayta so'rash. */
  async refreshTopup(id: string) {
    const topup = await this.db.topup.findUnique({ where: { id } });
    if (!topup) fail("To'ldirish topilmadi", 404);
    const result = await this.topups.refresh(topup);
    return {
      result,
      topup: await this.db.topup.findUniqueOrThrow({ where: { id } }),
    };
  }

  async fundingList(status: FundingStatus | undefined) {
    const ops = await this.db.fundingOperation.findMany({
      where: status ? { status } : { status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, clientId: true, firstName: true } },
      },
    });
    const adIds = [...new Set(ops.flatMap((o) => (o.adId ? [o.adId] : [])))];
    const ads = adIds.length
      ? await this.db.ad.findMany({
          where: { adId: { in: adIds } },
          select: { adId: true, title: true },
        })
      : [];
    const titles = new Map(ads.map((a) => [a.adId, a.title]));
    return {
      operations: ops.map((o) => ({
        ...o,
        adTitle: o.adId ? (titles.get(o.adId) ?? null) : null,
      })),
    };
  }
}
