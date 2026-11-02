import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../common/decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { shopSettingsSchema } from './shop-pricing.js';
import { ShopService } from './shop.service.js';

const settingsPatch = shopSettingsSchema.partial();

/** Admin: do'kon holati (hamkor balansi), ustamalar, buyurtmalar va qo'lda hal qilish. */
@AdminOnly()
@Controller('admin/shop')
export class AdminShopController {
  constructor(private readonly shop: ShopService) {}

  @Get()
  status() {
    return this.shop.adminStatus();
  }

  @Put('settings')
  settings(@Body(zodBody(settingsPatch)) body: z.output<typeof settingsPatch>) {
    return this.shop.updateSettings(body);
  }

  @Get('orders')
  async orders() {
    return { orders: await this.shop.adminOrders() };
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  refund(@Param('id') id: string) {
    return this.shop.adminRefund(id);
  }

  @Post('orders/:id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string) {
    return this.shop.adminRetry(id);
  }
}
