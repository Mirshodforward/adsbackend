import { Controller, Get } from '@nestjs/common';
import type { AuthContext } from '../common/auth-context.js';
import { Auth } from '../common/decorators.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('balance')
export class BalanceController {
  constructor(private readonly db: PrismaService) {}

  /**
   * Mijozga ko'rinadigan balans = bo'sh pul + e'lonlardagi hali sarflanmagan
   * qoldiq + Telegram javobi kutilayotgan amallar. U faqat haqiqiy sarf
   * bo'yicha kamayadi.
   */
  @Get()
  async summary(@Auth() ctx: AuthContext) {
    const [user, ads, pending, entries] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { clientId: true, balanceUzs: true },
      }),
      this.db.clientAd.aggregate({
        where: { userId: ctx.userId },
        _sum: { fundedUzs: true, spentUzs: true, refundedUzs: true },
      }),
      this.db.fundingOperation.aggregate({
        where: {
          userId: ctx.userId,
          status: 'PENDING',
          kind: { in: ['CREATE_AD', 'ADD_BUDGET'] },
        },
        _sum: { amountUzs: true },
      }),
      this.db.balanceEntry.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          amountUzs: true,
          balanceAfterUzs: true,
          adId: true,
          source: true,
          note: true,
          createdAt: true,
        },
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    const inAds = (ads._sum.fundedUzs ?? zero)
      .minus(ads._sum.spentUzs ?? zero)
      .minus(ads._sum.refundedUzs ?? zero)
      .plus(pending._sum.amountUzs ?? zero);

    return {
      clientId: user.clientId,
      freeUzs: user.balanceUzs,
      inAdsUzs: inAds,
      totalUzs: user.balanceUzs.plus(inAds),
      spentUzs: ads._sum.spentUzs ?? zero,
      entries,
    };
  }
}
