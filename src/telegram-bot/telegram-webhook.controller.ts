import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { AllowDirect, Public } from '../common/decorators.js';
import { fail } from '../common/http.js';
import { SkipRateLimit } from '../common/rate-limit.js';
import { BotUpdatesService } from './bot-updates.service.js';

/**
 * Telegram → @Osontarget_bot update'lari. BFF orqali emas, to'g'ridan-to'g'ri
 * keladi, shuning uchun himoya — `setWebhook`da berilgan sir
 * (`X-Telegram-Bot-Api-Secret-Token` header'i).
 *
 * Sir to'g'ri bo'lsa javob har doim 200: aks holda Telegram o'sha update'ni
 * qayta yuboradi va keyingi xabarlar navbatda qolib ketadi.
 */
// Telegram bir nechta IP'dan keladi — umumiy chegara unga tegmasin (sir himoya qiladi).
@SkipRateLimit()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly updates: BotUpdatesService) {}

  @Post('webhook')
  @HttpCode(200)
  @AllowDirect()
  @Public()
  async handle(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    if (!this.updates.verifySecret(secret)) fail("Ruxsat yo'q", 401);
    await this.updates.handle(body);
    return { ok: true };
  }
}
