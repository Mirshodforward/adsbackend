import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context.js';
import { Auth, Public } from '../common/decorators.js';
import { RateLimit } from '../common/rate-limit.js';
import { zodBody } from '../common/zod.pipe.js';
import { ShopService } from './shop.service.js';

const recipient = z.string().trim().min(1).max(64);
const recipientName = z.string().trim().max(128).optional();

const orderSchema = z.discriminatedUnion('product', [
  z.object({ product: z.literal('STARS'), recipient, recipientName, quantity: z.number().int().positive() }),
  z.object({ product: z.literal('PREMIUM'), recipient, recipientName, months: z.number().int().positive() }),
  z.object({
    product: z.literal('GIFT'),
    recipient,
    recipientName,
    // 64-bitli son — satr bo'lib keladi, songa aylantirilmaydi.
    giftId: z.string().regex(/^\d{1,32}$/),
    message: z.string().max(200).optional(),
    hideName: z.boolean().optional(),
  }),
]);

const searchSchema = z.object({
  product: z.enum(['STARS', 'PREMIUM', 'GIFT']),
  username: z.string().trim().min(1).max(64),
});

/** Kabinet do'koni: Telegram Stars, Premium, sovg'alar (balansdan, so'mda). */
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('options')
  options() {
    return this.shop.options();
  }

  /** Qabul qiluvchi profili (nik + rasm) — pul yechilmaydi. */
  @RateLimit(30)
  @Post('recipient')
  @HttpCode(200)
  recipient(@Body(zodBody(searchSchema)) body: z.output<typeof searchSchema>) {
    return this.shop.findRecipient(body.product, body.username);
  }

  @RateLimit(10)
  @Post('orders')
  create(@Auth() ctx: AuthContext, @Body(zodBody(orderSchema)) body: z.output<typeof orderSchema>) {
    return this.shop.createOrder(ctx.userId, body);
  }

  @Get('orders')
  async list(@Auth() ctx: AuthContext) {
    return { orders: await this.shop.list(ctx.userId) };
  }

  /** Frontend yetkazish holatini shu bilan so'raydi. */
  @Get('orders/:id')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.shop.get(ctx.userId, id);
  }

  /** Sovg'aning Lottie animatsiyasi (JSON) — landing ham ishlatadi, shuning uchun ochiq. */
  @Public()
  @RateLimit(240)
  @Get('gifts/:id/sticker')
  @Header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
  async sticker(@Param('id') id: string) {
    const body = await this.shop.giftSticker(id);
    if (!body) throw new NotFoundException({ error: 'Stiker topilmadi' });
    return new StreamableFile(body, { type: 'application/json' });
  }
}
