import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module.js';
import { AdsModule } from './ads/ads.module.js';
import { AuthModule } from './auth/auth.module.js';
import { InternalSecretGuard } from './common/guards/internal-secret.guard.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthController } from './health.controller.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PublicModule } from './public/public.module.js';
import { TelegramAdsModule } from './telegram-ads/telegram-ads.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SEC', { infer: true }),
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    TelegramAdsModule,
    AdsModule,
    PaymentsModule,
    AdminModule,
    PublicModule,
  ],
  controllers: [HealthController],
  // Tartib muhim: avval "so'rov BFF'danmi", keyin "foydalanuvchi kim".
  providers: [
    { provide: APP_GUARD, useClass: InternalSecretGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
