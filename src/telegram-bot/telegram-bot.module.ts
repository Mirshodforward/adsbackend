import { Module } from '@nestjs/common';
import { AdminAlertsService } from './admin-alerts.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

@Module({
  providers: [TelegramBotService, AdminAlertsService],
  exports: [TelegramBotService, AdminAlertsService],
})
export class TelegramBotModule {}
