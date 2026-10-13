import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [AdminSettingsController],
  providers: [PricingService],
  exports: [PricingService],
})
export class SettingsModule {}
