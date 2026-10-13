import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { z } from 'zod';
import { AllowDirect, Public } from '../../common/decorators.js';
import { fail } from '../../common/http.js';
import type { Env } from '../../config/env.js';
import { TopupsService } from '../topups.service.js';
import { verifyPaylinkerSignature } from './paylinker-signature.js';

/** Paylinker `webhooks.ts` yuboradigan tana (kerakli maydonlargina). */
const payloadSchema = z.object({
  event: z.string(),
  data: z.object({
    invoiceId: z.string().min(1),
    externalId: z.string().nullable(),
    status: z.enum([
      'PENDING',
      'PREPARED',
      'PAID',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
      'REFUNDED',
    ]),
    amount: z.number().nonnegative(),
  }),
});

/**
 * Paylinker → OsonTarget. BFF orqali emas, to'g'ridan-to'g'ri keladi, shuning
 * uchun himoya — faqat HMAC imzo (`X-Paylinker-Signature`, xom tana ustidan).
 *
 * Javob kodi Paylinker uchun signal: 2xx — yetkazildi; boshqasi — qayta uradi
 * (7 martagacha, 10 soniyadan 6 soatgacha). Shu sababli:
 *   - bizda yo'q to'ldirish → 200 (qayta urish foyda bermaydi);
 *   - ichki xato → 500 (qayta ursin, `applyInvoice` takrorga chidamli).
 */
@Controller('payments/paylinker')
export class PaylinkerWebhookController {
  private readonly logger = new Logger(PaylinkerWebhookController.name);

  constructor(
    private readonly topups: TopupsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @AllowDirect()
  @Public()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paylinker-signature') signature?: string,
    @Headers('x-paylinker-timestamp') timestamp?: string,
  ) {
    const secret = this.config.get('PAYLINKER_WEBHOOK_SECRET', { infer: true });
    if (!secret) fail('Webhook sozlanmagan', 503);

    if (
      !req.rawBody ||
      !verifyPaylinkerSignature({
        rawBody: req.rawBody,
        signature,
        timestamp,
        secret,
      })
    ) {
      this.logger.warn(`Imzosiz yoki noto'g'ri imzoli webhook (${req.ip})`);
      fail("Imzo noto'g'ri", 401);
    }

    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      this.logger.error(
        `Webhook tanasi tanilmadi: ${parsed.error.issues[0]?.message}`,
      );
      fail("Noto'g'ri tana", 400);
    }

    const { event, data } = parsed.data;
    if (!data.externalId) return { ok: true, result: 'unknown' };

    const result = await this.topups.applyInvoice({
      id: data.invoiceId,
      externalId: data.externalId,
      status: data.status,
      amount: data.amount,
    });
    if (result !== 'duplicate')
      this.logger.log(`${event} ${data.externalId}: ${result}`);
    return { ok: true, result };
  }
}
