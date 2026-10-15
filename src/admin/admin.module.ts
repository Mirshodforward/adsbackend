import { Module } from '@nestjs/common';
import { AdsModule } from '../ads/ads.module.js';
import { BalanceModule } from '../balance/balance.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramAdsModule } from '../telegram-ads/telegram-ads.module.js';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { AdminAdsController } from './admin-ads.controller.js';
import { AdminAdsService } from './admin-ads.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/**
 * Admin paneli (`/admin/*`, faqat ADMIN roli): platforma holati, mijozlar va
 * balanslari, barcha e'lonlar, to'ldirishlar. Narx sozlamalari — SettingsModule.
 */
@Module({
  imports: [
    AdsModule,
    BalanceModule,
    PaymentsModule,
    SettingsModule,
    TelegramAdsModule,
    TelegramBotModule,
  ],
  controllers: [AdminController, AdminAdsController],
  providers: [AdminService, AdminAdsService],
})
export class AdminModule {}
