import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BalanceModule } from '../balance/balance.module.js';
import type { Env } from '../config/env.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module.js';
import { AdminShopController } from './admin-shop.controller.js';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';
import { StarsPaymeeClient } from './starspaymee.client.js';

/** Do'kon: Telegram Stars, Premium va sovg'alar — StarsPaymee Partner API orqali. */
@Module({
  imports: [BalanceModule, SettingsModule, TelegramBotModule],
  controllers: [ShopController, AdminShopController],
  providers: [
    {
      provide: StarsPaymeeClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new StarsPaymeeClient({
          baseUrl: config.get('STARSPAYMEE_API_URL', { infer: true }),
          apiKey: config.get('STARSPAYMEE_API_KEY', { infer: true }),
          sandbox: config.get('STARSPAYMEE_SANDBOX', { infer: true }),
        }),
    },
    ShopService,
  ],
  exports: [ShopService],
})
export class ShopModule {}
