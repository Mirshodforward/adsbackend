import { describe, expect, it } from 'vitest';
import { PricingService, pricingSchema } from './pricing.service.js';

/** Sozlama va kurs qatorlari xotirada — baza va tarmoq yo'q. */
function service(rows: Record<string, object>) {
  const db = {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows[where.key] ? { key: where.key, value: rows[where.key] } : null,
    },
  };
  const config = { get: () => undefined };
  const alerts = { send: async () => true, clear: () => undefined };
  return new PricingService(db as never, config as never, alerts as never);
}

describe('PricingService', () => {
  it("standart sozlamalar: xizmat haqi 30%, USDT 12 250 so'm", () => {
    const s = pricingSchema.parse({});
    expect(s.commissionPercent).toBe(30);
    expect(s.manualUsdUzs).toBe(12_250);
    expect(s.manualUzsPerTon).toBeNull();
  });

  it("mijoz narxi = bozor kursi × (1 + xizmat haqi); CPM so'mda yuqoriga", async () => {
    const svc = service({
      ton_rate: {
        uzsPerTon: 16_084.25, // 1.313 USDT × 12 250
        tonUsd: 1.313,
        usdUzs: 12_250,
        fetchedAt: new Date().toISOString(),
        tonSource: 'tonapi',
        usdSource: "qo'lda",
      },
    });
    const p = await svc.getPricing();
    expect(p.uzsPerTon).toBe(20_909.53); // 16 084.25 × 1.3, 0.01 gacha
    expect(p.minCpmUzs).toBe(2_091); // 0.1 TON, yuqoriga
    expect(p.marketUzsPerTon).toBe(16_084.25);
    expect(p.tonSource).toBe('tonapi');
    expect(p.stale).toBe(false);
  });

  it("kurs 24 soatdan eski bo'lsa — stale; qo'lda kurs bo'lsa — eskirmaydi", async () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    const rate = { uzsPerTon: 16_000, tonUsd: 1.3, usdUzs: 12_250, fetchedAt: old };
    expect((await service({ ton_rate: rate }).getPricing()).stale).toBe(true);
    const manual = service({ ton_rate: rate, pricing: { manualUzsPerTon: 16_500 } });
    const p = await manual.getPricing();
    expect(p.stale).toBe(false);
    expect(p.uzsPerTon).toBe(21_450); // 16 500 × 1.3
  });
});
