import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context.js';
import { AdminOnly, Auth } from '../common/decorators.js';
import { fail } from '../common/http.js';
import { RecommendationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsSyncService } from './ads-sync.service.js';
import { OptimizerService } from './optimizer.service.js';

const statusSchema = z
  .enum(RecommendationStatus)
  .default(RecommendationStatus.PENDING);

@AdminOnly()
@Controller('admin')
export class AdminAdsController {
  constructor(
    private readonly db: PrismaService,
    private readonly sync: AdsSyncService,
    private readonly optimizer: OptimizerService,
  ) {}

  /** E'lonlar + oxirgi 24 soat ko'rsatkichlari + hisob holati. */
  @Get('ads')
  async ads() {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [ads, day] = await Promise.all([
      this.db.ad.findMany({
        orderBy: { adId: 'desc' },
        omit: { raw: true },
      }),
      this.db.adStat.groupBy({
        by: ['adId'],
        where: { fromTime: { gte: since } },
        _sum: { views: true, clicks: true, actions: true, spent: true },
      }),
    ]);
    const last24h = new Map(day.map((d) => [d.adId, d._sum]));

    return {
      account: this.sync.account,
      lastSyncAt: this.sync.lastSyncAt,
      ads: ads.map((ad) => {
        const d = last24h.get(ad.adId);
        return {
          ...ad,
          last24h: {
            views: d?.views ?? 0,
            clicks: d?.clicks ?? 0,
            actions: d?.actions ?? 0,
            spent: d?.spent?.toNumber() ?? 0,
          },
        };
      }),
    };
  }

  @Get('recommendations')
  recommendations(@Query('status') status?: string) {
    const parsed = statusSchema.safeParse(status);
    if (!parsed.success) fail("Noto'g'ri status");
    return this.optimizer.list(parsed.data);
  }

  @Post('recommendations/:id/apply')
  @HttpCode(200)
  apply(@Param('id') id: string, @Auth() ctx: AuthContext) {
    return this.optimizer.apply(id, ctx.userId);
  }

  @Post('recommendations/:id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id') id: string, @Auth() ctx: AuthContext) {
    return this.optimizer.dismiss(id, ctx.userId);
  }

  /** Hozir sinxronlash va tavsiyalarni qayta hisoblash. */
  @Post('ads/sync')
  @HttpCode(200)
  async syncNow() {
    const result = await this.sync.run();
    if (!result)
      fail("Sinxronlash allaqachon ketmoqda — birozdan so'ng yangilang", 409);
    return result;
  }
}
