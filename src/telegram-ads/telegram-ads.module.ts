import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { TelegramAdsClient } from './telegram-ads.client.js';

@Module({
  providers: [
    {
      provide: TelegramAdsClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new TelegramAdsClient({
          token: config.get('TELEGRAM_ADS_API_KEY', { infer: true }),
        }),
    },
  ],
  exports: [TelegramAdsClient],
})
export class TelegramAdsModule {}
