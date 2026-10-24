import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { FundingService } from '../src/ads/client/funding.service.js';
import { AppModule } from '../src/app.module.js';
import { BalanceService } from '../src/balance/balance.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../src/telegram-ads/telegram-ads.client.js';
import type { Ad as TgAd } from '../src/telegram-ads/telegram-ads.types.js';
import { INTERNAL_SECRET, widgetPayload } from './helpers.js';

const OWNER_TG = 9_920_000_000 + randomInt(1_000_000);
const OTHER_TG = OWNER_TG + 1;
let nextAdId = 910_000_000 + randomInt(1_000_000);

/** Soxta Telegram Ads hisobi: e'lonlar xotirada, haqiqiy TON sarflanmaydi. */
const remote = new Map<number, TgAd>();
/** Bajarilgan idempotent so'rovlar (kalit → natija). */
const doneKeys = new Map<string, TgAd>();
const fakeAds = {
  createAd: vi.fn(
    async (p: { initial_budget: number; idempotency_key: string }) => {
      const id = nextAdId++;
      const ad = {
        ad_id: id,
        title: 't',
        text: 'matn',
        promote_url: 'https://t.me/example_bot',
        currency: 'TON',
        cpm: 0.2,
        placement: 'channel_post',
        spent_budget: 0,
        remaining_budget: p.initial_budget,
        views: 0,
        actions: 0,
        created_date: 1_760_000_000,
        status: 'in_review',
      } as TgAd;
      remote.set(id, ad);
      return ad;
    },
  ),
  increaseAdBudget: vi.fn(async (p: { ad_id: number; amount: number }) => {
    const ad = remote.get(p.ad_id)!;
    ad.remaining_budget += p.amount;
    return { ...ad };
  }),
  decreaseAdBudget: vi.fn(
    async (p: { ad_id: number; amount: number; idempotency_key?: string }) => {
      // Telegram kabi: bir xil kalit bilan takror so'rov birinchi natijani qaytaradi.
      const cached = p.idempotency_key && doneKeys.get(p.idempotency_key);
      if (cached) return { ...cached };
      const ad = remote.get(p.ad_id)!;
      ad.remaining_budget -= p.amount;
      if (p.idempotency_key) doneKeys.set(p.idempotency_key, { ...ad });
      return { ...ad };
    },
  ),
  submitAdForReview: vi.fn(async (p: { ad_id: number }) => {
    const ad = remote.get(p.ad_id)!;
    ad.status = 'in_review';
    return { ...ad };
  }),
  editAd: vi.fn(async (p: { ad_id: number; is_paused?: boolean }) => {
    const ad = remote.get(p.ad_id)!;
    if (p.is_paused !== undefined) ad.is_paused = p.is_paused;
    return { ...ad };
  }),
  getAdsById: vi.fn(async (p: { ad_ids: number[] }) =>
    p.ad_ids.map((id) => ({ ...remote.get(id)! })),
  ),
  getTargetTopicsList: vi.fn(async () => [
    { topic_id: 48, name: 'Video Games' },
  ]),
  getTargetLanguagesList: vi.fn(async () => [
    { language_code: 'uz', name: 'Uzbek' },
  ]),
  getTargetCountriesList: vi.fn(async () => [
    { country_code: 'UZ', name: 'Uzbekistan' },
  ]),
};

const adInput = {
  promoteUrl: '@example_bot',
  placement: 'channel_post',
  text: 'E2E reklama matni',
  target: { type: 'users', countryCodes: ['UZ'], languageCodes: ['uz'] },
  budgetUzs: 100_000,
  cpmUzs: 4_000,
};

describe("Mijoz e'lonlari va balans (e2e)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let funding: FundingService;
  let balance: BalanceService;
  let owner: { token: string; id: string };
  let other: { token: string; id: string };
  let hadPricing = false;

  const http = () => request(app.getHttpServer());
  const api = (token: string) => ({
    get: (path: string) =>
      http()
        .get(path)
        .set('x-internal-secret', INTERNAL_SECRET)
        .set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      http()
        .post(path)
        .set('x-internal-secret', INTERNAL_SECRET)
        .set('Authorization', `Bearer ${token}`),
  });
  const freeBalance = async () =>
    (
      await db.user.findUniqueOrThrow({ where: { id: owner.id } })
    ).balanceUzs.toNumber();

  async function login(id: number) {
    const res = await http()
      .post('/api/auth/telegram')
      .set('x-internal-secret', INTERNAL_SECRET)
      .send(
        widgetPayload({
          id,
          first_name: 'E2E',
          auth_date: Math.floor(Date.now() / 1000),
        }),
      )
      .expect(200);
    return {
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramAdsClient)
      .useValue(fakeAds)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    funding = app.get(FundingService);
    balance = app.get(BalanceService);

    owner = await login(OWNER_TG);
    other = await login(OTHER_TG);
    // 1 TON = 18 181.82 so'm + 10% komissiya = 20 000 so'm (mijoz narxi).
    hadPricing = !!(await db.setting.findUnique({ where: { key: 'pricing' } }));
    if (!hadPricing) {
      await db.setting.create({
        data: {
          key: 'pricing',
          value: {
            commissionPercent: 10,
            minBudgetUzs: 30_000,
            minCpmTon: 0.1,
            manualUzsPerTon: 18_181.82,
          },
        },
      });
    }
  });

  afterAll(async () => {
    const ids = [owner.id, other.id];
    await db.fundingOperation.deleteMany({ where: { userId: { in: ids } } });
    const ads = await db.clientAd.findMany({ where: { userId: { in: ids } } });
    await db.clientAd.deleteMany({ where: { userId: { in: ids } } });
    await db.ad.deleteMany({ where: { adId: { in: ads.map((a) => a.adId) } } });
    await db.balanceEntry.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (!hadPricing) await db.setting.delete({ where: { key: 'pricing' } });
    await app.close();
  });

  beforeEach(() => vi.clearAllMocks());

  it("to'ldirish takrorlansa balans bir marta oshadi", async () => {
    const first = await balance.credit(owner.id, '150000.50', {
      source: 'E2E',
      externalId: `inv-${OWNER_TG}`,
    });
    const again = await balance.credit(owner.id, 150_000.5, {
      source: 'E2E',
      externalId: `inv-${OWNER_TG}`,
    });
    expect(first.credited).toBe(true);
    expect(again).toMatchObject({ credited: false });
    expect(await freeBalance()).toBe(150_000.5);
  });

  it("menyu uchun lug'atlar, narx (faqat so'mda) va balans", async () => {
    const res = await api(owner.token).get('/api/ads/options').expect(200);
    expect(res.body).toMatchObject({
      topics: [{ topic_id: 48 }],
      // 0.1 TON × 20 000 so'm
      pricing: { minCpmUzs: 2_000, minBudgetUzs: 30_000, stale: false },
      balanceUzs: '150000.5',
    });
    // Kurs va xizmat haqi mijozga chiqmaydi — ulardan marjani hisoblab bo'lardi.
    expect(res.body.pricing).not.toHaveProperty('uzsPerTon');
    expect(res.body.pricing).not.toHaveProperty('commissionPercent');
    expect(res.body.pricing).not.toHaveProperty('marketUzsPerTon');
    expect(res.body).not.toHaveProperty('recommendedCpmTon');
    expect(res.body.recommendedCpmUzs.channel_post).toBeGreaterThanOrEqual(2_000);
  });

  it("ochiq narxlar (sayt uchun) — loginsiz, faqat so'mda", async () => {
    const res = await http()
      .get('/api/public/pricing')
      .set('x-internal-secret', INTERNAL_SECRET)
      .expect(200);
    expect(res.body).toMatchObject({
      minBudgetUzs: 30_000,
      minCpmUzs: 2_000,
      stale: false,
    });
    expect(res.body.paymentMethods).toContain('Click');
    expect(JSON.stringify(res.body)).not.toMatch(/commission|uzsPerTon|market|TON/i);
    // Sirsiz — yopiq (uni faqat Next server chaqiradi).
    await http().get('/api/public/pricing').expect(403);
  });

  let adId: number;

  it("e'lon yaratadi: balans yechiladi, Telegram'ga TON'da, idempotency kaliti bilan", async () => {
    const res = await api(owner.token)
      .post('/api/ads')
      .send(adInput)
      .expect(201);
    expect(res.body.status).toBe('DONE');
    adId = res.body.adId;

    const call = fakeAds.createAd.mock.calls[0][0];
    expect(call).toMatchObject({
      initial_budget: 5,
      cpm: 0.2,
      promote_url: 'https://t.me/example_bot',
    });
    const op = await db.fundingOperation.findFirstOrThrow({
      where: { userId: owner.id, kind: 'CREATE_AD' },
    });
    expect(call.idempotency_key).toBe(op.id);

    expect(await freeBalance()).toBe(50_000.5);
    const entry = await db.balanceEntry.findFirstOrThrow({
      where: { operationId: op.id },
    });
    expect(entry).toMatchObject({ type: 'AD_FUNDING', adId });
    expect(entry.amountUzs.toNumber()).toBe(-100_000);

    const summary = await api(owner.token).get('/api/balance').expect(200);
    expect(summary.body).toMatchObject({
      freeUzs: '50000.5',
      inAdsUzs: '100000',
      totalUzs: '150000.5',
    });
  });

  it("pul yetmasa 402 va hech narsa o'zgarmaydi", async () => {
    await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, budgetUzs: 60_000 })
      .expect(402);
    expect(fakeAds.createAd).not.toHaveBeenCalled();
    expect(await freeBalance()).toBe(50_000.5);
  });

  it('Telegram rad etsa pul darhol qaytadi', async () => {
    fakeAds.createAd.mockRejectedValueOnce(
      new TelegramAdsError('TEXT_INVALID', 'createAd', 200),
    );
    const res = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, budgetUzs: 40_000 })
      .expect(422);
    expect(res.body.error).toContain('qaytarildi');
    expect(await freeBalance()).toBe(50_000.5);
  });

  it('javob kelmasa PENDING; sinxronlash xuddi shu kalit bilan yakunlaydi', async () => {
    fakeAds.createAd.mockRejectedValueOnce(
      new TelegramAdsError('NETWORK_ERROR', 'createAd'),
    );
    const res = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, budgetUzs: 40_000 })
      .expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(await freeBalance()).toBe(10_000.5); // pul ushlab turiladi

    const op = await db.fundingOperation.findFirstOrThrow({
      where: { userId: owner.id, status: 'PENDING' },
    });
    await db.fundingOperation.update({
      where: { id: op.id },
      data: { updatedAt: new Date(Date.now() - 5 * 60_000) },
    });
    await funding.reconcile();

    expect(fakeAds.createAd).toHaveBeenCalledTimes(2);
    expect(fakeAds.createAd.mock.calls[1][0].idempotency_key).toBe(op.id);
    expect(
      await db.fundingOperation.findUniqueOrThrow({ where: { id: op.id } }),
    ).toMatchObject({ status: 'DONE' });
  });

  it("boshqa mijoz e'lonni ko'ra ham, boshqara ham olmaydi", async () => {
    await api(other.token).get(`/api/ads/${adId}`).expect(404);
    await api(other.token).post(`/api/ads/${adId}/pause`).expect(404);
    const list = await api(other.token).get('/api/ads').expect(200);
    expect(list.body.ads).toHaveLength(0);
  });

  it("sarf o'rtacha kurs bo'yicha so'mga aylanadi", async () => {
    // Telegram sarf qilganda qoldiq ham kamayadi.
    remote.get(adId)!.spent_budget = 1.25;
    remote.get(adId)!.remaining_budget -= 1.25;
    await db.ad.update({ where: { adId }, data: { spentBudget: 1.25 } });
    await funding.updateSpend();
    const ad = await api(owner.token).get(`/api/ads/${adId}`).expect(200);
    expect(ad.body).toMatchObject({ spentUzs: '25000', heldUzs: '75000' });
    // TON qiymatlari mijozga chiqmaydi, CPM faqat so'mda.
    expect(ad.body).not.toHaveProperty('cpm');
    expect(ad.body).not.toHaveProperty('remainingBudget');
    expect(ad.body).not.toHaveProperty('currency');
    expect(ad.body.cpmUzs).toBe('4000');
  });

  it("budjet qo'shiladi va yakunlashda qoldiq balansga qaytadi", async () => {
    await balance.credit(owner.id, 50_000, {
      source: 'E2E',
      externalId: `inv2-${OWNER_TG}`,
    });
    await api(owner.token)
      .post(`/api/ads/${adId}/budget`)
      .send({ amountUzs: 20_000 })
      .expect(200);
    expect(fakeAds.increaseAdBudget.mock.calls[0][0]).toMatchObject({
      ad_id: adId,
      amount: 1,
    });

    await api(owner.token).post(`/api/ads/${adId}/close`).expect(200);
    expect(fakeAds.editAd).toHaveBeenCalledWith({
      ad_id: adId,
      is_paused: true,
    });

    // 10 daqiqa o'tmaguncha qaytarilmaydi.
    await funding.reconcile();
    expect(fakeAds.decreaseAdBudget).not.toHaveBeenCalled();

    const close = await db.fundingOperation.findFirstOrThrow({
      where: { adId, kind: 'CLOSE_AD' },
    });
    await db.fundingOperation.update({
      where: { id: close.id },
      data: { notBefore: new Date(Date.now() - 1000) },
    });
    const before = await freeBalance();
    await funding.reconcile();

    // Telegram'da 5 + 1 − 1.25 = 4.75 TON qoldi → o'rtacha kurs 20 000 → 95 000 so'm.
    expect(fakeAds.decreaseAdBudget).toHaveBeenCalledWith({
      ad_id: adId,
      amount: 4.75,
      idempotency_key: close.id,
    });
    expect(await freeBalance()).toBe(before + 95_000);
    const ad = await api(owner.token).get(`/api/ads/${adId}`).expect(200);
    expect(ad.body).toMatchObject({ refundedUzs: '95000', heldUzs: '0' });
    expect(ad.body.closedAt).not.toBeNull();
    await api(owner.token)
      .post(`/api/ads/${adId}/budget`)
      .send({ amountUzs: 20_000 })
      .expect(409);
  });
  it("ready_for_review holatida yaratilgan e'lon moderatsiyaga yuboriladi", async () => {
    await balance.credit(owner.id, 100_000, {
      source: 'E2E',
      externalId: `inv3-${OWNER_TG}`,
    });
    fakeAds.createAd.mockImplementationOnce(
      async (p: { initial_budget: number }) => {
        const id = nextAdId++;
        const ad = {
          ad_id: id,
          title: 't',
          text: 'matn',
          promote_url: 'https://t.me/example_bot',
          currency: 'TON',
          cpm: 0.2,
          placement: 'channel_post',
          spent_budget: 0,
          remaining_budget: p.initial_budget,
          views: 0,
          actions: 0,
          created_date: 1_760_000_000,
          status: 'ready_for_review',
        } as TgAd;
        remote.set(id, ad);
        return ad;
      },
    );
    const res = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, budgetUzs: 30_000 })
      .expect(201);
    expect(fakeAds.submitAdForReview).toHaveBeenCalledWith({
      ad_id: res.body.adId,
    });
    const ad = await db.ad.findUniqueOrThrow({ where: { adId: res.body.adId } });
    expect(ad.status).toBe('in_review');
  });

  it("yakunlash: Telegram javobi yo'qolsa ham qoldiq bir marta va to'liq qaytadi; yakunlanayotgan e'lon o'zgartirilmaydi", async () => {
    const before = await freeBalance();
    const res = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, budgetUzs: 40_000 }) // 2 TON (20 000 so'm/TON)
      .expect(201);
    const id = res.body.adId as number;
    expect(await freeBalance()).toBe(before - 40_000);

    await api(owner.token).post(`/api/ads/${id}/close`).expect(200);
    // Yakunlash navbatda — davom ettirish, budjet, narx yopiq.
    await api(owner.token).post(`/api/ads/${id}/resume`).expect(409);
    await api(owner.token)
      .post(`/api/ads/${id}/budget`)
      .send({ amountUzs: 20_000 })
      .expect(409);
    await api(owner.token)
      .post(`/api/ads/${id}/cpm`)
      .send({ cpmUzs: 5_000 })
      .expect(409);

    const op = await db.fundingOperation.findFirstOrThrow({
      where: { adId: id, kind: 'CLOSE_AD' },
    });
    await db.fundingOperation.update({
      where: { id: op.id },
      data: { notBefore: new Date(Date.now() - 1000) },
    });

    // 1-urinish: Telegram budjetni qaytardi, lekin javob yo'lda yo'qoldi.
    fakeAds.decreaseAdBudget.mockImplementationOnce(
      async (p: { ad_id: number; amount: number; idempotency_key?: string }) => {
        const ad = remote.get(p.ad_id)!;
        ad.remaining_budget -= p.amount;
        doneKeys.set(p.idempotency_key!, { ...ad });
        throw new TelegramAdsError('NETWORK_ERROR', 'decreaseAdBudget');
      },
    );
    await funding.reconcile();
    const mid = await db.fundingOperation.findUniqueOrThrow({
      where: { id: op.id },
    });
    expect(mid).toMatchObject({ status: 'PENDING', attempts: 1 });
    // Telegram'ga yuborishdan oldin yozilgan qoldiq.
    expect(mid.amountTon.toNumber()).toBe(2);
    expect(remote.get(id)!.remaining_budget).toBe(0);
    expect(await freeBalance()).toBe(before - 40_000);

    // 2-urinish (11 daqiqadan keyin): xuddi shu kalit → Telegram eski natijani qaytaradi.
    await db.fundingOperation.update({
      where: { id: op.id },
      data: { notBefore: new Date(Date.now() - 1000) },
    });
    await funding.reconcile();
    expect(fakeAds.decreaseAdBudget).toHaveBeenCalledTimes(2);
    expect(fakeAds.decreaseAdBudget.mock.calls[1][0]).toMatchObject({
      ad_id: id,
      amount: 2,
      idempotency_key: op.id,
    });
    expect(
      await db.fundingOperation.findUniqueOrThrow({ where: { id: op.id } }),
    ).toMatchObject({ status: 'DONE' });
    expect(await freeBalance()).toBe(before); // 40 000 to'liq qaytdi
    const ad = await api(owner.token).get(`/api/ads/${id}`).expect(200);
    expect(ad.body).toMatchObject({ refundedUzs: '40000', heldUzs: '0' });
  });
  it("premium emoji va avatar: matn Ads formatida ketadi, minimal narx +80%", async () => {
    const star = { offset: 0, length: 1, id: '5190768311394130762' };
    // Oddiy minimal narx (0.1 TON = 2 000 so'm) emoji+avatar bilan kam — 400, pul yechilmaydi.
    const before = await freeBalance();
    const cheap = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, text: '⭐ Matn', emoji: [star], showUserpic: true, cpmUzs: 2_000 })
      .expect(400);
    expect(cheap.body.error).toMatch(/premium emoji va avatar/);
    expect(await freeBalance()).toBe(before);

    const res = await api(owner.token)
      .post('/api/ads')
      .send({ ...adInput, text: '⭐ Matn', emoji: [star], showUserpic: true, cpmUzs: 3_600 })
      .expect(201);
    const call = fakeAds.createAd.mock.calls.at(-1)![0] as unknown as {
      text: string;
      show_userpic?: boolean;
      cpm: number;
    };
    expect(call.text).toBe('![⭐](tg://emoji?id=5190768311394130762) Matn');
    expect(call.show_userpic).toBe(true);
    expect(call.cpm).toBe(0.18);
    // Katalog va eskiz endpointlari mavjud (eskiz — tarmoqsiz muhitda 404).
    const catalog = await api(owner.token).get('/api/ads/emoji').expect(200);
    expect(catalog.body.items.length).toBeGreaterThan(50);
    expect(catalog.body.items[0]).toMatchObject({ ch: expect.any(String), id: expect.any(String) });
    await api(owner.token).get('/api/ads/emoji/abc/thumb').expect(404);
    // Tozalash: e'lonni yopamiz — qoldiq balansga qaytadi (keyingi testlar balansga tayanadi).
    await api(owner.token).post(`/api/ads/${res.body.adId}/close`).expect(200);
  });
});
