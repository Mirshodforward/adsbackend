import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { toAdRow } from '../src/ads/ad-row.js';
import { AppModule } from '../src/app.module.js';
import type { RecommendationKind } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  TelegramAdsClient,
  TelegramAdsError,
} from '../src/telegram-ads/telegram-ads.client.js';
import type { Ad as TgAd } from '../src/telegram-ads/telegram-ads.types.js';
import { INTERNAL_SECRET, widgetPayload } from './helpers.js';

const AD_ID = 900_000_000 + randomInt(1_000_000);
const ADMIN_TG = 9_910_000_000 + randomInt(1_000_000);
const CLIENT_TG = ADMIN_TG + 1;

const baseAd: TgAd = {
  ad_id: AD_ID,
  title: "E2E e'lon",
  text: 'matn',
  promote_url: 'https://t.me/example_bot',
  currency: 'TON',
  cpm: 0.18,
  placement: 'channel_post',
  spent_budget: 1,
  remaining_budget: 0.03,
  views: 1000,
  clicks: 20,
  actions: 10,
  action_type: 'start_bot',
  created_date: 1_760_000_000,
  status: 'active',
};

/** Soxta Telegram Ads — testlar haqiqiy hisobdan TON sarflamasin. */
let remote: TgAd;
const fakeAds = {
  getAdsById: vi.fn(async () => [remote]),
  increaseAdBudget: vi.fn(async (p: { amount: number }) => {
    remote = {
      ...remote,
      remaining_budget: remote.remaining_budget + p.amount,
    };
    return remote;
  }),
  editAd: vi.fn(async (p: { is_paused?: boolean; cpm?: number }) => {
    remote = { ...remote, ...p };
    return remote;
  }),
};

describe('Admin ads (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let adminToken: string;
  let clientToken: string;

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
    return res.body.accessToken as string;
  }

  const recommend = (kind: RecommendationKind, change: object) =>
    db.recommendation.create({
      data: {
        adId: AD_ID,
        kind,
        reason: 'e2e',
        change,
        snapshot: { cpm: 0.18, isPaused: false, remainingBudget: 0.03 },
      },
    });
  const statusOf = async (id: string) =>
    (await db.recommendation.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramAdsClient)
      .useValue(fakeAds)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);

    adminToken = await login(ADMIN_TG);
    clientToken = await login(CLIENT_TG);
    // Rol har so'rovda bazadan o'qiladi — tokenni qayta olish shart emas.
    await db.user.update({
      where: { telegramId: BigInt(ADMIN_TG) },
      data: { role: 'ADMIN' },
    });
    await db.ad.create({ data: toAdRow(baseAd) });
  });

  afterAll(async () => {
    await db.ad.deleteMany({ where: { adId: AD_ID } });
    await db.user.deleteMany({
      where: { telegramId: { in: [BigInt(ADMIN_TG), BigInt(CLIENT_TG)] } },
    });
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    remote = { ...baseAd };
  });

  it("admin bo'lmagan foydalanuvchiga 403", async () => {
    await api(clientToken)
      .get('/api/admin/ads')
      .expect(403, { error: "Ruxsat yo'q" });
    await api(clientToken).get('/api/admin/recommendations').expect(403);
  });

  it("admin e'lonlar va tavsiyalarni ko'radi", async () => {
    const rec = await recommend('ADD_BUDGET', { amount: 0.56 });

    const ads = await api(adminToken).get('/api/admin/ads').expect(200);
    const ad = ads.body.ads.find((a: { adId: number }) => a.adId === AD_ID);
    expect(ad).toMatchObject({ title: "E2E e'lon", last24h: { views: 0 } });
    expect(ad.raw).toBeUndefined();

    const recs = await api(adminToken)
      .get('/api/admin/recommendations')
      .expect(200);
    expect(
      recs.body.find((r: { id: string }) => r.id === rec.id),
    ).toMatchObject({ kind: 'ADD_BUDGET', ad: { title: "E2E e'lon" } });
  });

  it("budjetni idempotency kaliti bilan qo'shadi — ikki marta bosilsa ham bir marta", async () => {
    const rec = await recommend('ADD_BUDGET', { amount: 0.56 });

    const res = await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(200);
    expect(res.body.status).toBe('APPLIED');
    expect(fakeAds.increaseAdBudget).toHaveBeenCalledExactlyOnceWith({
      ad_id: AD_ID,
      amount: 0.56,
      idempotency_key: rec.id,
    });
    const ad = await db.ad.findUniqueOrThrow({ where: { adId: AD_ID } });
    expect(ad.remainingBudget.toNumber()).toBeCloseTo(0.59);

    await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(409);
    expect(fakeAds.increaseAdBudget).toHaveBeenCalledTimes(1);
  });

  it("e'lon tavsiyadan keyin o'zgargan bo'lsa — qo'llanmaydi, EXPIRED", async () => {
    remote = { ...baseAd, cpm: 0.25 }; // CPM Telegram'da qo'lda o'zgartirilgan
    const rec = await recommend('RAISE_CPM', { cpm: 0.2 });

    await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(409);
    expect(fakeAds.editAd).not.toHaveBeenCalled();
    expect(await statusOf(rec.id)).toBe('EXPIRED');
  });

  it("rad etilgan tavsiyani qo'llab bo'lmaydi", async () => {
    const rec = await recommend('PAUSE', { is_paused: true });

    await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/dismiss`)
      .expect(200);
    await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(409);
    expect(fakeAds.editAd).not.toHaveBeenCalled();
    expect(await statusOf(rec.id)).toBe('DISMISSED');
  });

  it('Telegram xatosida FAILED va xato kodi saqlanadi', async () => {
    fakeAds.increaseAdBudget.mockRejectedValueOnce(
      new TelegramAdsError('NOT_ENOUGH_BUDGET', 'increaseAdBudget', 200),
    );
    const rec = await recommend('ADD_BUDGET', { amount: 99 });

    const res = await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(502);
    expect(res.body.error).toContain('NOT_ENOUGH_BUDGET');
    expect(
      await db.recommendation.findUniqueOrThrow({ where: { id: rec.id } }),
    ).toMatchObject({ status: 'FAILED', error: 'NOT_ENOUGH_BUDGET' });
  });

  it("pauza tavsiyasi editAd orqali qo'llanadi", async () => {
    const rec = await recommend('PAUSE', { is_paused: true });

    await api(adminToken)
      .post(`/api/admin/recommendations/${rec.id}/apply`)
      .expect(200);
    expect(fakeAds.editAd).toHaveBeenCalledExactlyOnceWith({
      ad_id: AD_ID,
      is_paused: true,
    });
    const ad = await db.ad.findUniqueOrThrow({ where: { adId: AD_ID } });
    expect(ad.isPaused).toBe(true);
  });
});
