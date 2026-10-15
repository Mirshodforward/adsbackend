import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { toAdRow } from '../src/ads/ad-row.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PricingService } from '../src/settings/pricing.service.js';
import { TelegramAdsClient } from '../src/telegram-ads/telegram-ads.client.js';
import type { Ad as TgAd } from '../src/telegram-ads/telegram-ads.types.js';
import { TelegramBotService } from '../src/telegram-bot/telegram-bot.service.js';
import { INTERNAL_SECRET, widgetPayload } from './helpers.js';

const AD_ID = 900_000_000 + randomInt(1_000_000);
const ADMIN_TG = 9_910_000_000 + randomInt(1_000_000);
const CLIENT_TG = ADMIN_TG + 1;

const baseAd: TgAd = {
  ad_id: AD_ID,
  title: "E2E platforma e'loni",
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
  editAd: vi.fn(async (p: { is_paused?: boolean; cpm?: number }) => {
    remote = { ...remote, ...p };
    return remote;
  }),
};
const fakeBot = { sendMessage: vi.fn(async () => true) };

describe('Admin paneli (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let pricing: PricingService;
  let admin: { token: string; id: string };
  let client: { token: string; id: string; clientId: number };
  let savedSettings: Awaited<ReturnType<PricingService['settings']>>;
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
    put: (path: string) =>
      http()
        .put(path)
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
    return {
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
      clientId: res.body.user.clientId as number,
    };
  }

  const freeBalance = async () =>
    (
      await db.user.findUniqueOrThrow({ where: { id: client.id } })
    ).balanceUzs.toNumber();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramAdsClient)
      .useValue(fakeAds)
      .overrideProvider(TelegramBotService)
      .useValue(fakeBot)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    pricing = app.get(PricingService);

    admin = await login(ADMIN_TG);
    client = await login(CLIENT_TG);
    // Rol har so'rovda bazadan o'qiladi — tokenni qayta olish shart emas.
    await db.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
    await db.ad.create({ data: toAdRow(baseAd) });

    hadPricing = !!(await db.setting.findUnique({ where: { key: 'pricing' } }));
    savedSettings = await pricing.settings();
  });

  afterAll(async () => {
    if (hadPricing) await pricing.updateSettings(savedSettings);
    else await db.setting.deleteMany({ where: { key: 'pricing' } });
    await db.ad.deleteMany({ where: { adId: AD_ID } });
    await db.balanceEntry.deleteMany({
      where: { userId: { in: [admin.id, client.id] } },
    });
    await db.user.deleteMany({ where: { id: { in: [admin.id, client.id] } } });
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    remote = { ...baseAd };
  });

  it("admin bo'lmagan foydalanuvchiga 403", async () => {
    await api(client.token)
      .get('/api/admin/overview')
      .expect(403, { error: "Ruxsat yo'q" });
    await api(client.token).get('/api/admin/users').expect(403);
    await api(client.token).get('/api/admin/ads').expect(403);
    await api(client.token).get('/api/admin/settings').expect(403);
  });

  it("umumiy ko'rinish: mijozlar, pul, e'lonlar, narx", async () => {
    const res = await api(admin.token).get('/api/admin/overview').expect(200);
    expect(res.body.clients.total).toBeGreaterThanOrEqual(2);
    expect(res.body.pricing).toHaveProperty('commissionPercent');
    expect(res.body.money).toHaveProperty('freeUzs');
    expect(res.body.ads).toHaveProperty('active');
    expect(res.body.attention).toMatchObject({ pendingFunding: expect.any(Number) });
  });

  it('mijozlar: qidiruv mijoz raqami bo‘yicha', async () => {
    const res = await api(admin.token)
      .get(`/api/admin/users?q=${client.clientId}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.users[0]).toMatchObject({
      id: client.id,
      clientId: client.clientId,
      telegramId: String(CLIENT_TG),
      adsCount: 0,
      inAdsUzs: '0',
    });
  });

  it("balansni tuzatish: qo'shish, yetmasa yechib bo'lmaydi, jurnal", async () => {
    await api(admin.token)
      .post(`/api/admin/users/${client.id}/adjust`)
      .send({ amountUzs: 25_000, note: 'Bonus' })
      .expect(200);
    expect(await freeBalance()).toBe(25_000);
    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);

    await api(admin.token)
      .post(`/api/admin/users/${client.id}/adjust`)
      .send({ amountUzs: -30_000, note: 'Xato' })
      .expect(409);
    expect(await freeBalance()).toBe(25_000);

    await api(admin.token)
      .post(`/api/admin/users/${client.id}/adjust`)
      .send({ amountUzs: -5_000, note: 'Qaytarish' })
      .expect(200);
    expect(await freeBalance()).toBe(20_000);

    await api(admin.token)
      .post(`/api/admin/users/${client.id}/adjust`)
      .send({ amountUzs: 0, note: 'hech' })
      .expect(400);

    const detail = await api(admin.token)
      .get(`/api/admin/users/${client.id}`)
      .expect(200);
    expect(detail.body.balance).toMatchObject({
      freeUzs: '20000',
      inAdsUzs: '0',
      totalUzs: '20000',
    });
    const types = detail.body.entries.map((e: { type: string }) => e.type);
    expect(types).toEqual(['ADJUSTMENT', 'ADJUSTMENT']);
    expect(detail.body.entries[0].note).toContain('admin E2E');
  });

  it("bloklash sessiyalarni yopadi; o'zini bloklab bo'lmaydi", async () => {
    await api(admin.token)
      .post(`/api/admin/users/${admin.id}/active`)
      .send({ isActive: false })
      .expect(400);

    await api(admin.token)
      .post(`/api/admin/users/${client.id}/active`)
      .send({ isActive: false })
      .expect(200, { isActive: false });
    await api(client.token).get('/api/auth/me').expect(401);
    const sessions = await db.session.findMany({
      where: { userId: client.id, revokedAt: null },
    });
    expect(sessions).toHaveLength(0);

    await api(admin.token)
      .post(`/api/admin/users/${client.id}/active`)
      .send({ isActive: true })
      .expect(200, { isActive: true });
    await api(client.token).get('/api/auth/me').expect(200);
  });

  it("e'lonlar ro'yxati: platforma e'loni egasiz, pauza Telegram orqali", async () => {
    const list = await api(admin.token).get('/api/admin/ads').expect(200);
    const ad = list.body.ads.find((a: { adId: number }) => a.adId === AD_ID);
    expect(ad).toMatchObject({
      title: "E2E platforma e'loni",
      owner: null,
      last24h: { views: 0 },
    });
    expect(ad.raw).toBeUndefined();

    await api(admin.token).post(`/api/admin/ads/${AD_ID}/pause`).expect(200);
    expect(fakeAds.editAd).toHaveBeenCalledExactlyOnceWith({
      ad_id: AD_ID,
      is_paused: true,
    });
    const row = await db.ad.findUniqueOrThrow({ where: { adId: AD_ID } });
    expect(row.isPaused).toBe(true);

    // Platforma e'lonini "yakunlash" mijoz pulini qaytarish amali — unga tegishli emas.
    await api(admin.token).post(`/api/admin/ads/${AD_ID}/close`).expect(404);
    await api(admin.token).post('/api/admin/ads/1/pause').expect(404);
  });

  it("sozlamalar: xizmat haqi va to'ldirish chegaralari", async () => {
    const res = await api(admin.token)
      .put('/api/admin/settings')
      .send({ commissionPercent: 50, topupMinUzs: 50_000, topupMaxUzs: 10_000_000 })
      .expect(200);
    expect(res.body).toMatchObject({
      commissionPercent: 50,
      topupMinUzs: 50_000,
      topupMaxUzs: 10_000_000,
    });

    await api(admin.token)
      .put('/api/admin/settings')
      .send({ topupMinUzs: 20_000_000 })
      .expect(400);

    const methods = await api(client.token)
      .get('/api/payments/methods')
      .expect(200);
    expect(methods.body).toMatchObject({ minUzs: 50_000, maxUzs: 10_000_000 });
  });

  it("to'ldirishlar va pul amallari ro'yxati ochiladi", async () => {
    const topups = await api(admin.token).get('/api/admin/topups').expect(200);
    expect(topups.body).toMatchObject({ page: 1, topups: expect.any(Array) });
    await api(admin.token).get('/api/admin/topups?status=XYZ').expect(400);

    const funding = await api(admin.token).get('/api/admin/funding').expect(200);
    expect(funding.body.operations).toEqual(expect.any(Array));
  });
});
