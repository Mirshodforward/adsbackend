import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context.js';
import { Auth } from '../../common/decorators.js';
import { fail } from '../../common/http.js';
import { zodBody } from '../../common/zod.pipe.js';
import { ClientAdsService } from './client-ads.service.js';

const username = z.string().trim().min(4).max(64);

const createSchema = z.object({
  promoteUrl: z.string().trim().min(1).max(300),
  placement: z.enum(['channel_post', 'bot_banner', 'search_result']),
  text: z.string().trim().max(160).default(''),
  websiteName: z.string().trim().min(1).max(40).optional(),
  button: z
    .enum([
      'subscribe',
      'view',
      'read',
      'learn_more',
      'download',
      'open',
      'sign_up',
      'buy',
      'order',
      'play',
      'try',
      'leave_request',
    ])
    .optional(),
  target: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('users'),
      countryCodes: z.array(z.string().length(2)).min(1).max(8),
      languageCodes: z.array(z.string().min(2).max(10)).max(8).default([]),
      topicIds: z.array(z.number().int().positive()).max(20).default([]),
      excludeTopicIds: z.array(z.number().int().positive()).max(20).default([]),
    }),
    z.object({
      type: z.literal('channels'),
      channels: z.array(username).min(1).max(100),
    }),
    z.object({
      type: z.literal('bots'),
      bots: z.array(username).min(1).max(100),
    }),
    z.object({
      type: z.literal('search'),
      queries: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
    }),
  ]),
  budgetUzs: z.number().int().positive().max(1_000_000_000),
  cpmUzs: z.number().positive().max(10_000_000),
  dailyLimitUzs: z.number().int().positive().optional(),
  impressionFrequency: z.number().int().min(1).max(4).optional(),
});

const budgetSchema = z.object({
  amountUzs: z.number().int().positive().max(1_000_000_000),
});

const cpmSchema = z.object({
  cpmUzs: z.number().positive().max(10_000_000),
});

/** Mijozning o'z e'lonlari — har bir amal faqat egasiga. */
@Controller('ads')
export class ClientAdsController {
  constructor(private readonly ads: ClientAdsService) {}

  @Get('options')
  options(@Auth() ctx: AuthContext) {
    return this.ads.getOptions(ctx.userId);
  }

  @Get('resolve')
  resolve(@Query('kind') kind: string, @Query('q') q: string) {
    if (kind !== 'channel' && kind !== 'bot') fail('kind: channel yoki bot');
    return this.ads.resolve(kind, q ?? '');
  }

  @Get()
  list(@Auth() ctx: AuthContext) {
    return this.ads.list(ctx.userId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Auth() ctx: AuthContext,
    @Body(zodBody(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.ads.create(ctx.userId, body);
  }

  @Get(':adId')
  detail(@Auth() ctx: AuthContext, @Param('adId', ParseIntPipe) adId: number) {
    return this.ads.detail(ctx.userId, adId);
  }

  @Post(':adId/pause')
  @HttpCode(200)
  pause(@Auth() ctx: AuthContext, @Param('adId', ParseIntPipe) adId: number) {
    return this.ads.setPaused(ctx.userId, adId, true);
  }

  @Post(':adId/resume')
  @HttpCode(200)
  resume(@Auth() ctx: AuthContext, @Param('adId', ParseIntPipe) adId: number) {
    return this.ads.setPaused(ctx.userId, adId, false);
  }

  @Post(':adId/budget')
  @HttpCode(200)
  budget(
    @Auth() ctx: AuthContext,
    @Param('adId', ParseIntPipe) adId: number,
    @Body(zodBody(budgetSchema)) body: z.infer<typeof budgetSchema>,
  ) {
    return this.ads.addBudget(ctx.userId, adId, body.amountUzs);
  }

  /** 1000 ko'rish narxini o'zgartirish — Telegram Ads'dagi kabi istalgan vaqtda. */
  @Post(':adId/cpm')
  @HttpCode(200)
  cpm(
    @Auth() ctx: AuthContext,
    @Param('adId', ParseIntPipe) adId: number,
    @Body(zodBody(cpmSchema)) body: z.infer<typeof cpmSchema>,
  ) {
    return this.ads.setCpm(ctx.userId, adId, body.cpmUzs);
  }

  @Post(':adId/close')
  @HttpCode(200)
  close(@Auth() ctx: AuthContext, @Param('adId', ParseIntPipe) adId: number) {
    return this.ads.close(ctx.userId, adId);
  }
}
