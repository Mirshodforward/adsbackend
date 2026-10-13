import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  // rawBody — to'lov webhook'lari imzoni xom tana ustidan tekshiradi
  // (payments/paylinker/paylinker-webhook.controller.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Mijoz IP'si `req.ip`dan emas, BFF uzatgan header'dan olinadi
  // (qarang: common/client-meta.ts) — shuning uchun `trust proxy` kerak emas.
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  const host = config.get('HOST', { infer: true });
  await (host ? app.listen(port, host) : app.listen(port));
  new Logger('Bootstrap').log(
    `Backend: http://${host ?? 'localhost'}:${port}/api`,
  );
}

await bootstrap();
