import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context.js';
import { AdminOnly, Auth } from '../common/decorators.js';
import { fail } from '../common/http.js';
import { zodBody } from '../common/zod.pipe.js';
import { FundingStatus, TopupStatus } from '../generated/prisma/client.js';
import { AdminService } from './admin.service.js';

const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);

const adjustSchema = z.object({
  /** ± so'm, tiyingacha. */
  amountUzs: z
    .number()
    .refine((n) => n !== 0 && Math.abs(n) <= 100_000_000, 'summa 0 bo\'lmasin')
    .transform((n) => Math.round(n * 100) / 100),
  note: z.string().trim().min(2).max(200),
});
const activeSchema = z.object({ isActive: z.boolean() });
const roleSchema = z.object({ role: z.enum(['CLIENT', 'ADMIN']) });

function page(raw: string | undefined) {
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success) fail("Noto'g'ri sahifa");
  return parsed.data;
}

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  users(@Query('q') q?: string, @Query('page') p?: string) {
    return this.admin.users((q ?? '').slice(0, 64), page(p));
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.user(id);
  }

  @Post('users/:id/adjust')
  @HttpCode(200)
  adjust(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(adjustSchema)) body: z.output<typeof adjustSchema>,
  ) {
    return this.admin.adjust(ctx.userId, id, body.amountUzs, body.note);
  }

  @Post('users/:id/active')
  @HttpCode(200)
  active(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(activeSchema)) body: z.infer<typeof activeSchema>,
  ) {
    return this.admin.setActive(ctx.userId, id, body.isActive);
  }

  @Post('users/:id/role')
  @HttpCode(200)
  role(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(roleSchema)) body: z.infer<typeof roleSchema>,
  ) {
    return this.admin.setRole(ctx.userId, id, body.role);
  }

  @Get('topups')
  topups(@Query('status') status?: string, @Query('page') p?: string) {
    const parsed = z.enum(TopupStatus).optional().safeParse(status || undefined);
    if (!parsed.success) fail("Noto'g'ri status");
    return this.admin.topupsList(parsed.data, page(p));
  }

  @Post('topups/:id/refresh')
  @HttpCode(200)
  refreshTopup(@Param('id') id: string) {
    return this.admin.refreshTopup(id);
  }

  @Get('funding')
  funding(@Query('status') status?: string) {
    const parsed = z
      .enum(FundingStatus)
      .optional()
      .safeParse(status || undefined);
    if (!parsed.success) fail("Noto'g'ri status");
    return this.admin.fundingList(parsed.data);
  }
}
