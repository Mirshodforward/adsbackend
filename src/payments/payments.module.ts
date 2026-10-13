import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BalanceModule } from '../balance/balance.module.js';
import type { Env } from '../config/env.js';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { PaylinkerClient } from './paylinker/paylinker.client.js';
import { PaylinkerWebhookController } from './paylinker/paylinker-webhook.controller.js';
import { TopupsController } from './topups.controller.js';
import { TopupsService } from './topups.service.js';

/** Balansni to'ldirish (PAYMENTS.md). Pul balansga faqat `BalanceService.credit()` orqali kiradi. */
@Module({
  imports: [BalanceModule, TelegramBotModule],
  controllers: [TopupsController, PaylinkerWebhookController],
  providers: [
    {
      provide: PaylinkerClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PaylinkerClient({
          apiKey: config.get('PAYLINKER_API_KEY', { infer: true }),
          baseUrl: config.get('PAYLINKER_API_BASE', { infer: true }),
        }),
    },
    TopupsService,
  ],
})
export class PaymentsModule {}
