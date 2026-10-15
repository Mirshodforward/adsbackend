import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../common/decorators.js';
import { fail } from '../common/http.js';
import { zodBody } from '../common/zod.pipe.js';
import { PricingService } from './pricing.service.js';

const updateSchema = z
  .object({
    commissionPercent: z.number().min(0).max(300),
    minBudgetUzs: z.number().int().positive(),
    minCpmTon: z.number().positive(),
    manualUzsPerTon: z.number().positive().nullable(),
    topupMinUzs: z.number().int().positive(),
    topupMaxUzs: z.number().int().positive(),
    topupFeePercent: z.number().min(0).max(50),
  })
  .partial();

@AdminOnly()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  get() {
    return this.pricing.getPricing();
  }

  @Put()
  async update(@Body(zodBody(updateSchema)) body: z.infer<typeof updateSchema>) {
    const current = await this.pricing.settings();
    const next = { ...current, ...body };
    if (next.topupMinUzs > next.topupMaxUzs) {
      fail("To'ldirishning eng kam summasi eng ko'pidan katta bo'lmasin");
    }
    return this.pricing.updateSettings(body);
  }

  /** Bozor kursini hozir yangilash. */
  @Post('refresh-rate')
  @HttpCode(200)
  async refreshRate() {
    const rate = await this.pricing.refreshRate();
    if (!rate) fail("Kursni olib bo'lmadi — birozdan so'ng urinib ko'ring", 502);
    return this.pricing.getPricing();
  }
}
