import { Controller, Get } from '@nestjs/common';
import { AdsOptionsService } from '../ads/client/ads-options.service.js';
import { Public } from '../common/decorators.js';
import { GATEWAY_METHODS } from '../payments/methods.js';
import { TopupsService } from '../payments/topups.service.js';
import { PricingService } from '../settings/pricing.service.js';

/**
 * Sayt (bosh sahifa, blog) uchun ochiq narxlar — faqat mijoz ko'radigan so'mdagi
 * qiymatlar. Kurs, xizmat haqi va TON bu yerda yo'q.
 *
 * Login talab qilinmaydi, lekin ichki sir talab qilinadi: uni Vercel'dagi Next
 * server keshlab chaqiradi (soatiga bir marta), brauzer emas.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly pricing: PricingService,
    private readonly options: AdsOptionsService,
    private readonly topups: TopupsService,
  ) {}

  @Get('pricing')
  async pricingInfo() {
    const [pricing, recommendedCpmUzs, limits] = await Promise.all([
      this.pricing.getPricing(),
      this.options.recommendedCpmUzs(),
      this.topups.limits(),
    ]);
    const live = this.topups.methods();
    return {
      minBudgetUzs: pricing.minBudgetUzs,
      minCpmUzs: pricing.uzsPerTon > 0 ? pricing.minCpmUzs : null,
      recommendedCpmUzs,
      topupMinUzs: limits.minUzs,
      topupMaxUzs: limits.maxUzs,
      /** Hozir ishlayotgan to'lov usullari; bo'sh bo'lsa — rejadagilari. */
      paymentMethods: (live.length ? live : GATEWAY_METHODS).map((m) => m.label),
      paymentsLive: live.length > 0,
      stale: pricing.stale,
      updatedAt: pricing.rateUpdatedAt,
    };
  }
}
