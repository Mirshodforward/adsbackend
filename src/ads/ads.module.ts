import { Module } from '@nestjs/common';
import { TelegramAdsModule } from '../telegram-ads/telegram-ads.module.js';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { AdminAdsController } from './admin-ads.controller.js';
import { AdsSyncService } from './ads-sync.service.js';
import { OptimizerService } from './optimizer.service.js';

@Module({
  imports: [TelegramAdsModule, TelegramBotModule],
  controllers: [AdminAdsController],
  providers: [AdsSyncService, OptimizerService],
})
export class AdsModule {}
