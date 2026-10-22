import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context.js';
import { Auth } from '../common/decorators.js';
import { RateLimit } from '../common/rate-limit.js';
import { zodBody } from '../common/zod.pipe.js';
import { TopupsService } from './topups.service.js';

const createSchema = z.object({
  method: z.enum(['CLICK', 'PAYME', 'UZUM', 'PAYNET']),
  // Chegaralar (min/max) servisda — ular .env'dan keladi
  amountUzs: z.number().int().positive(),
});

@Controller('payments')
export class TopupsController {
  constructor(private readonly topups: TopupsService) {}

  /** To'ldirish sahifasi: yoqilgan usullar va summa chegaralari. */
  @Get('methods')
  async methods() {
    return { methods: this.topups.methods(), ...(await this.topups.limits()) };
  }

  @RateLimit(10)
  @Post('topups')
  create(
    @Auth() ctx: AuthContext,
    @Body(zodBody(createSchema)) body: z.output<typeof createSchema>,
  ) {
    return this.topups.create(ctx.userId, body.method, body.amountUzs);
  }

  @Get('topups')
  async list(@Auth() ctx: AuthContext) {
    return { topups: await this.topups.list(ctx.userId) };
  }

  /** Frontend to'lov ekranida shuni har 4 soniyada so'raydi. */
  @Get('topups/:id')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.topups.get(ctx.userId, id);
  }
}
