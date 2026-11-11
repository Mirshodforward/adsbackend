import { Module } from '@nestjs/common';
import { AdminAlertsService } from './admin-alerts.service.js';
import { BotUpdatesService } from './bot-updates.service.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';

@Module({
  controllers: [TelegramWebhookController],
  providers: [TelegramBotService, AdminAlertsService, BotUpdatesService],
  exports: [TelegramBotService, AdminAlertsService],
})
export class TelegramBotModule {}
