import { Module } from '@nestjs/common';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [TelegramBotModule],
  controllers: [AdminSettingsController],
  providers: [PricingService],
  exports: [PricingService],
})
export class SettingsModule {}
