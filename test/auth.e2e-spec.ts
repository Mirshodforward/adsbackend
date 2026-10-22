import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { INTERNAL_SECRET, webAppInitData, widgetPayload } from './helpers.js';

// Haqiqiy foydalanuvchilar bilan to'qnashmaydigan id; afterAll'da o'chiriladi.
const TELEGRAM_ID = 9_900_000_000 + randomInt(1_000_000);
/** Mini App testi uchun alohida foydalanuvchi (asosiysi oxirida bloklanadi). */
const MINI_APP_ID = TELEGRAM_ID + 1;

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { telegramId: { in: [BigInt(TELEGRAM_ID), BigInt(MINI_APP_ID)] } },
    });
    await app.close();
  });

  // BFF'dek: har so'rovda ichki sir.
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('x-internal-secret', INTERNAL_SECRET);
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-secret', INTERNAL_SECRET);

  const login = () =>
    post('/api/auth/telegram')
      .set('x-real-client-ip', '203.0.113.7')
      .set('x-real-user-agent', 'e2e-browser')
      .send(
        widgetPayload({
          id: TELEGRAM_ID,
          first_name: 'Test',
          username: 'e2e_user',
          auth_date: Math.floor(Date.now() / 1000),
        }),
      );

  it('health sirsiz ham ochiq', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200, { ok: true });
  });

  it("ichki sirsiz yoki noto'g'ri sir bilan 403", async () => {
    await request(app.getHttpServer())
      .post('/api/auth/telegram')
      .send({})
      .expect(403, { error: "Ruxsat yo'q" });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-internal-secret', 'x'.repeat(48))
      .expect(403);
  });

  it("token bo'lmasa himoyalangan endpoint 401 qaytaradi", async () => {
    await get('/api/auth/me').expect(401, { error: 'Tizimga kiring' });
  });

  it("soxta imzo bilan kirib bo'lmaydi", async () => {
    await post('/api/auth/telegram')
      .send({
        id: TELEGRAM_ID,
        first_name: 'Hacker',
        auth_date: Math.floor(Date.now() / 1000),
        hash: 'a'.repeat(64),
      })
      .expect(401);
  });

  it('login → me → refresh → logout', async () => {
    const first = await login().expect(200);
    expect(first.body.user).toMatchObject({
      telegramId: String(TELEGRAM_ID),
      firstName: 'Test',
      username: 'e2e_user',
      role: 'CLIENT',
    });

    // BFF uzatgan mijoz ma'lumoti sessiyaga yozildi (sir mos kelgani uchun).
    const session = await db.session.findFirstOrThrow({
      where: { userId: first.body.user.id },
    });
    expect(session).toMatchObject({
      ip: '203.0.113.7',
      userAgent: 'e2e-browser',
    });

    const me = await get('/api/auth/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(first.body.user.id);

    const refreshed = await post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(first.body.refreshToken);

    // Parallel so'rov: eski token grace oynasida hali qabul qilinadi.
    await post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);

    await post('/api/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(200, { ok: true });

    // Logout butun oilani yopadi — oiladagi har qanday token endi yaroqsiz.
    await post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    await post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
  });

  it('bloklangan foydalanuvchi access token bilan ham kira olmaydi', async () => {
    const { body } = await login().expect(200);
    await db.user.update({
      where: { id: body.user.id },
      data: { isActive: false },
    });

    await get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(401);
    await login().expect(403);
  });
  it("Mini App initData bilan kirish (widget'siz); soxta imzo — 401", async () => {
    const initData = webAppInitData({
      user: JSON.stringify({ id: MINI_APP_ID, first_name: 'Mini', username: 'e2e_mini' }),
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAE2Equery',
    });
    const res = await post('/api/auth/telegram-webapp')
      .send({ initData })
      .expect(200);
    expect(res.body.user).toMatchObject({
      telegramId: String(MINI_APP_ID),
      firstName: 'Mini',
    });
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();

    await post('/api/auth/telegram-webapp')
      .send({ initData: initData.replace(/hash=[0-9a-f]{64}/, `hash=${'0'.repeat(64)}`) })
      .expect(401);
    await post('/api/auth/telegram-webapp').send({ initData: '' }).expect(400);
  });
});
