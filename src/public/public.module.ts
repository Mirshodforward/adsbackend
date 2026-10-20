import { Module } from '@nestjs/common';
import { AdsModule } from '../ads/ads.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PublicController } from './public.controller.js';

/** Sayt sahifalari uchun ochiq (loginsiz) ma'lumotlar. */
@Module({
  imports: [AdsModule, PaymentsModule, SettingsModule],
  controllers: [PublicController],
})
export class PublicModule {}
