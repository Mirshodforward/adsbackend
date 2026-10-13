import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../common/decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { PricingService } from './pricing.service.js';

const updateSchema = z
  .object({
    commissionPercent: z.number().min(0).max(100),
    minBudgetUzs: z.number().int().positive(),
    minCpmTon: z.number().positive(),
    manualUzsPerTon: z.number().positive().nullable(),
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
  update(@Body(zodBody(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.pricing.updateSettings(body);
  }
}
