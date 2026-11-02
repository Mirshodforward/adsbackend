import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { BalanceService } from '../src/balance/balance.service.js';
import { RateLimitGuard } from '../src/common/rate-limit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PricingService } from '../src/settings/pricing.service.js';
import { ShopService } from '../src/shop/shop.service.js';
import { PartnerError, StarsPaymeeClient } from '../src/shop/starspaymee.client.js';
import { TelegramBotService } from '../src/telegram-bot/telegram-bot.service.js';
import { INTERNAL_SECRET, widgetPayload } from './helpers.js';

const OWNER_TG = 9_930_000_000 + randomInt(1_000_000);
const OTHER_TG = OWNER_TG + 1;
const ADMIN_TG = OWNER_TG + 2;

const GIFT = { gift_id: '5170145012310081615', stars: 15, price_usdt: 0.2475, emoji: '💝', title: null, limited: false, remains: null };

/** Soxta StarsPaymee Partner API — tarmoqqa chiqilmaydi. */
const partner = {
  configured: true,
  sandbox: false,
  balanceUsdt: 100,
  balance: vi.fn(async () => ({ balance_usdt: partner.balanceUsdt })),
  pricing: vi.fn(async () => ({
    stars: { min: 50, max: 10_000, usdt_per_star: 0.0153 },
    premium: { months: [3, 6, 12], usdt: { '3': 12, '6': 16, '12': 29 } },
  })),
  gifts: vi.fn(async () => [GIFT]),
  search: vi.fn(async (type: string, q: string) => {
    if (q === 'nobody') throw new PartnerError(404, { error: 'Fragment uni topmadi' });
    return { recipient: q, name: 'Test User', photo: 'https://t.me/i/userpic/320/x.jpg', myself: false, premium: type === 'premium' ? false : undefined };
  }),
  stars: vi.fn(async (_u: string, n: number) => ({ success: true, order_id: 11, status: 'completed', usdt_charged: n * 0.0153, transaction_id: 'frg_1' })),
  premium: vi.fn(async () => ({ success: true, order_id: 12, status: 'completed', usdt_charged: 12 })),
  gift: vi.fn(async () => ({ success: true, order_id: 13, status: 'completed', usdt_charged: 0.2475 })),
  giftSticker: vi.fn(async () => Buffer.from('{"v":"5.7.4","fr":60}')),
};
const fakeBot = { sendMessage: vi.fn(async () => true) };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Do'kon (e2e)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let shop: ShopService;
  let balance: BalanceService;
  let owner: string;
  let other: string;
  let admin: string;
  let ownerId: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (p: string) => http().get(p).set('x-internal-secret', INTERNAL_SECRET).set('Authorization', `Bearer ${token}`),
    post: (p: string) => http().post(p).set('x-internal-secret', INTERNAL_SECRET).set('Authorization', `Bearer ${token}`),
    put: (p: string) => http().put(p).set('x-internal-secret', INTERNAL_SECRET).set('Authorization', `Bearer ${token}`),
  });
  async function login(id: number) {
    const res = await http()
      .post('/api/auth/telegram')
      .set('x-internal-secret', INTERNAL_SECRET)
      .send(widgetPayload({ id, first_name: 'Shop', username: `shop_${id}`, auth_date: Math.floor(Date.now() / 1000) }))
      .expect(200);
    return res.body.accessToken as string;
  }
  const free = async () => (await db.user.findUniqueOrThrow({ where: { id: ownerId } })).balanceUzs.toNumber();
  /** Fonda yetkazish tugashini kutadi. */
  async function settle(id: string, token = owner) {
    for (let i = 0; i < 40; i++) {
      const r = await as(token).get(`/api/shop/orders/${id}`).expect(200);
      if (r.body.status !== 'PROCESSING') return r.body;
      await sleep(50);
    }
    return (await as(token).get(`/api/shop/orders/${id}`)).body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StarsPaymeeClient)
      .useValue(partner)
      .overrideProvider(TelegramBotService)
      .useValue(fakeBot)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    shop = app.get(ShopService);
    balance = app.get(BalanceService);
    // Kurs bazada bo'lmasligi mumkin — do'kon USDT kursini shu yerdan oladi.
    const pricing = app.get(PricingService);
    const real = await pricing.getPricing();
    vi.spyOn(pricing, 'getPricing').mockResolvedValue({ ...real, usdUzs: 12_250 });
    await db.setting.deleteMany({ where: { key: 'shop' } });
    owner = await login(OWNER_TG);
    other = await login(OTHER_TG);
    await db.user.update({ where: { telegramId: BigInt(ADMIN_TG) }, data: { role: 'ADMIN' } }).catch(() => null);
    await login(ADMIN_TG);
    await db.user.update({ where: { telegramId: BigInt(ADMIN_TG) }, data: { role: 'ADMIN' } });
    admin = await login(ADMIN_TG);
    ownerId = (await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(OWNER_TG) } })).id;
  });

  afterAll(async () => {
    const users = await db.user.findMany({ where: { telegramId: { in: [OWNER_TG, OTHER_TG, ADMIN_TG].map(BigInt) } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.shopOrder.deleteMany({ where: { userId: { in: ids } } });
    await db.balanceEntry.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.setting.deleteMany({ where: { key: 'shop' } });
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    partner.balanceUsdt = 100;
    app.get(RateLimitGuard).reset();
  });

  it("narxlar: 1⭐ = 220, Premium 3 oy = 160 300, 15⭐ sovg'a = 4 500 so'm", async () => {
    const r = await as(owner).get('/api/shop/options').expect(200);
    expect(r.body.enabled).toBe(true);
    expect(r.body.available).toBe(true);
    expect(r.body.stars.unitUzs).toBe(220);
    expect(r.body.stars.presets.find((p: { quantity: number }) => p.quantity === 100).priceUzs).toBe(22_000);
    expect(r.body.premium.map((p: { months: number; priceUzs: number }) => [p.months, p.priceUzs])).toEqual([
      [3, 160_300],
      [6, 213_700],
      [12, 387_300],
    ]);
    expect(r.body.gifts[0]).toMatchObject({ id: GIFT.gift_id, priceUzs: 4_500, available: true });
    const pub = await http().get('/api/public/shop').set('x-internal-secret', INTERNAL_SECRET).expect(200);
    expect(pub.body).toMatchObject({ starsUnitUzs: 220, giftFromUzs: 4_500 });
  });

  it('qabul qiluvchi: topildi / Stars uchun topilmadi — 404 / sovg\'a uchun tekshirilmagan', async () => {
    const ok = await as(owner).post('/api/shop/recipient').send({ product: 'STARS', username: '@friend_one' }).expect(200);
    expect(ok.body).toMatchObject({ username: 'friend_one', name: 'Test User', verified: true });
    await as(owner).post('/api/shop/recipient').send({ product: 'STARS', username: 'nobody' }).expect(404);
    const g = await as(owner).post('/api/shop/recipient').send({ product: 'GIFT', username: 'nobody' }).expect(200);
    expect(g.body).toMatchObject({ username: 'nobody', verified: false });
    await as(owner).post('/api/shop/recipient').send({ product: 'STARS', username: '1bad' }).expect(400);
  });

  it("balans yetmasa — 402, buyurtma ochilmaydi, hamkorga so'rov ketmaydi", async () => {
    const r = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_one', quantity: 100 }).expect(402);
    expect(r.body.needUzs).toBe(22_000);
    expect(partner.stars).not.toHaveBeenCalled();
    expect(await db.shopOrder.count({ where: { userId: ownerId } })).toBe(0);
  });

  it("noto'g'ri miqdor va muddat — 400", async () => {
    await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_one', quantity: 20 }).expect(400);
    await as(owner).post('/api/shop/orders').send({ product: 'PREMIUM', recipient: 'friend_one', months: 4 }).expect(400);
    await as(owner).post('/api/shop/orders').send({ product: 'GIFT', recipient: 'friend_one', giftId: '999' }).expect(409);
  });

  it("Stars: balansdan yechiladi, fonda yetkaziladi → COMPLETED, jurnalda SHOP_PURCHASE", async () => {
    await balance.adjust(ownerId, 500_000, 'e2e: do\'kon sinovi');
    const before = await free();
    const r = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: '@friend_one', recipientName: 'Test User', quantity: 100 }).expect(201);
    expect(r.body).toMatchObject({ status: 'PROCESSING', priceUzs: 22_000, quantity: 100, recipient: 'friend_one' });
    const done = await settle(r.body.id);
    expect(done.status).toBe('COMPLETED');
    expect(partner.stars).toHaveBeenCalledWith('friend_one', 100, r.body.id); // idempotency_key = order.id
    expect(await free()).toBe(before - 22_000);
    const entry = await db.balanceEntry.findFirstOrThrow({ where: { source: 'SHOP', externalId: r.body.id } });
    expect(entry.type).toBe('SHOP_PURCHASE');
    expect(entry.amountUzs.toNumber()).toBe(-22_000);
    expect(fakeBot.sendMessage).toHaveBeenCalled();
  });

  it("Premium va sovg'a: to'g'ri hamkor chaqiruvi", async () => {
    const p = await as(owner).post('/api/shop/orders').send({ product: 'PREMIUM', recipient: 'friend_one', months: 3 }).expect(201);
    expect((await settle(p.body.id)).status).toBe('COMPLETED');
    expect(partner.premium).toHaveBeenCalledWith('friend_one', 3, p.body.id);
    const g = await as(owner)
      .post('/api/shop/orders')
      .send({ product: 'GIFT', recipient: 'friend_one', giftId: GIFT.gift_id, message: '  Tabriklayman!  ', hideName: true })
      .expect(201);
    expect((await settle(g.body.id)).status).toBe('COMPLETED');
    expect(partner.gift).toHaveBeenCalledWith({
      recipient: 'friend_one',
      giftId: GIFT.gift_id,
      message: 'Tabriklayman!',
      hideName: true,
      idempotencyKey: g.body.id,
    });
  });

  it("qabul qiluvchi rad etsa — FAILED, pul BIR MARTA qaytadi", async () => {
    partner.gift.mockRejectedValueOnce(new PartnerError(400, { error: 'refuses', error_code: 'recipient_refuses' }));
    const before = await free();
    const r = await as(owner).post('/api/shop/orders').send({ product: 'GIFT', recipient: 'closed_user', giftId: GIFT.gift_id }).expect(201);
    const done = await settle(r.body.id);
    expect(done.status).toBe('FAILED');
    expect(done.error).toMatch(/sovg'a qabul qilishni yopib/);
    expect(await free()).toBe(before);
    // Takroriy qaytarish urinishi — hech narsa qilmaydi.
    const row = await db.shopOrder.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(await shop.failAndRefund({ ...row, status: 'PROCESSING' }, 'yana')).toBe(false);
    expect(await free()).toBe(before);
    expect(await db.balanceEntry.count({ where: { source: 'SHOP_REFUND', externalId: r.body.id } })).toBe(1);
  });

  it('Fragment xatosi (502) — FAILED va qaytarish', async () => {
    partner.stars.mockRejectedValueOnce(new PartnerError(502, { error: 'Fragment xatosi', status: 'failed' }));
    const before = await free();
    const r = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_two', quantity: 50 }).expect(201);
    expect((await settle(r.body.id)).status).toBe('FAILED');
    expect(await free()).toBe(before);
  });

  it("javob kelmasa — PROCESSING qoladi, cron o'sha kalit bilan so'raydi va yakunlaydi", async () => {
    partner.stars.mockRejectedValueOnce(new PartnerError(0, {}, 'timeout'));
    const before = await free();
    const r = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_three', quantity: 50 }).expect(201);
    await sleep(150);
    expect((await as(owner).get(`/api/shop/orders/${r.body.id}`)).body.status).toBe('PROCESSING');
    expect(await free()).toBe(before - 11_000); // pul yechilgan, qaytarilmagan
    await db.shopOrder.update({ where: { id: r.body.id }, data: { attemptedAt: new Date(Date.now() - 10 * 60_000) } });
    await shop.reconcile();
    expect(partner.stars).toHaveBeenLastCalledWith('friend_three', 50, r.body.id);
    expect((await settle(r.body.id)).status).toBe('COMPLETED');
  });

  it("hamkor balansi yetmasa — 503, mijozdan pul olinmaydi", async () => {
    partner.balanceUsdt = 0.1;
    const before = await free();
    await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_one', quantity: 50 }).expect(503);
    expect(await free()).toBe(before);
    const opt = await as(owner).get('/api/shop/options').expect(200);
    expect(opt.body.gifts[0].available).toBe(false);
  });

  it('ikki marta bosish — o\'sha buyurtma qaytadi', async () => {
    partner.stars.mockImplementationOnce(async () => ({ success: true, order_id: 20, status: 'processing' }) as never);
    const a = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_four', quantity: 50 }).expect(201);
    const b = await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_four', quantity: 50 }).expect(201);
    expect(b.body.id).toBe(a.body.id);
  });

  it('boshqa mijozning buyurtmasi ko\'rinmaydi', async () => {
    const mine = await as(owner).get('/api/shop/orders').expect(200);
    expect(mine.body.orders.length).toBeGreaterThan(0);
    await as(other).get(`/api/shop/orders/${mine.body.orders[0].id}`).expect(404);
    expect((await as(other).get('/api/shop/orders').expect(200)).body.orders).toEqual([]);
  });

  it("admin: holat, ustama, qotgan buyurtmani qaytarish; mijozga yopiq", async () => {
    await as(owner).get('/api/admin/shop').expect(403);
    const st = await as(admin).get('/api/admin/shop').expect(200);
    expect(st.body).toMatchObject({ configured: true, partnerBalanceUsdt: 100 });
    const upd = await as(admin).put('/api/admin/shop/settings').send({ starsMarkupPercent: 30 }).expect(200);
    expect(upd.body.prices.starsUnitUzs).toBe(244); // 0.0153 × 12 250 × 1.3 = 243.6
    await as(admin).put('/api/admin/shop/settings').send({ starsMarkupPercent: 17 }).expect(200);

    const stuck = await db.shopOrder.findFirstOrThrow({ where: { userId: ownerId, status: 'PROCESSING' } });
    const before = await free();
    await as(admin).post(`/api/admin/shop/orders/${stuck.id}/refund`).expect(200);
    expect(await free()).toBe(before + stuck.priceUzs.toNumber());
    await as(admin).post(`/api/admin/shop/orders/${stuck.id}/refund`).expect(400); // ikkinchi marta yo'q
    const list = await as(admin).get('/api/admin/shop/orders').expect(200);
    expect(list.body.orders.some((o: { id: string; status: string }) => o.id === stuck.id && o.status === 'FAILED')).toBe(true);
  });

  it("do'kon o'chirilsa — options enabled:false, buyurtma 503", async () => {
    await as(admin).put('/api/admin/shop/settings').send({ enabled: false }).expect(200);
    expect((await as(owner).get('/api/shop/options').expect(200)).body).toMatchObject({ enabled: false, reason: 'disabled' });
    await as(owner).post('/api/shop/orders').send({ product: 'STARS', recipient: 'friend_one', quantity: 50 }).expect(503);
    await as(admin).put('/api/admin/shop/settings').send({ enabled: true }).expect(200);
  });

  it("sovg'a stikeri — ochiq, JSON, kesh sarlavhasi bilan", async () => {
    const r = await http().get(`/api/shop/gifts/${GIFT.gift_id}/sticker`).set('x-internal-secret', INTERNAL_SECRET).expect(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.headers['cache-control']).toMatch(/max-age=86400/);
    await http().get('/api/shop/gifts/abc/sticker').set('x-internal-secret', INTERNAL_SECRET).expect(404);
  });
});
