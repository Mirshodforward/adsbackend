import { Module } from '@nestjs/common';
import { BalanceModule } from '../balance/balance.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramAdsModule } from '../telegram-ads/telegram-ads.module.js';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { AdminAdsController } from './admin-ads.controller.js';
import { AdsSyncService } from './ads-sync.service.js';
import { AdsOptionsService } from './client/ads-options.service.js';
import { ClientAdsController } from './client/client-ads.controller.js';
import { ClientAdsService } from './client/client-ads.service.js';
import { FundingService } from './client/funding.service.js';
import { OptimizerService } from './optimizer.service.js';

@Module({
  imports: [
    TelegramAdsModule,
    TelegramBotModule,
    BalanceModule,
    SettingsModule,
  ],
  controllers: [AdminAdsController, ClientAdsController],
  providers: [
    AdsSyncService,
    OptimizerService,
    ClientAdsService,
    FundingService,
    AdsOptionsService,
  ],
})
export class AdsModule {}
