import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomInt } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  PaylinkerClient,
  PaylinkerError,
  type PaylinkerInvoice,
} from '../src/payments/paylinker/paylinker.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PricingService } from '../src/settings/pricing.service.js';
import { TelegramBotService } from '../src/telegram-bot/telegram-bot.service.js';
import { INTERNAL_SECRET, widgetPayload } from './helpers.js';

// AppModule importidan OLDIN: ConfigModule .env'ni modul yuklanayotganda tekshiradi.
const WEBHOOK_SECRET = vi.hoisted(() => {
  const secret = 'whsec_e2e_0123456789abcdef';
  process.env.PAYLINKER_API_KEY = 'pk_test_e2e';
  process.env.PAYLINKER_WEBHOOK_SECRET = secret;
  process.env.PAYNET_APP_MERCHANT = '54304';
  process.env.PAYMENT_METHODS = 'CLICK,PAYME,UZUM,PAYNET';
  return secret;
});

/** Summa chegaralari — admin sozlamalarida; test o'ziga qulayini qo'yadi va qaytaradi. */
const TEST_LIMITS = { topupMinUzs: 10_000, topupMaxUzs: 2_500_000, topupFeePercent: 0 };

const OWNER_TG = 9_920_000_000 + randomInt(1_000_000);
const OTHER_TG = OWNER_TG + 1;

/** Soxta Paylinker — invoice'lar xotirada, tarmoqqa chiqilmaydi. */
const invoices = new Map<string, PaylinkerInvoice>();
let seq = 0;
const fakePaylinker = {
  configured: true,
  createInvoice: vi.fn(
    async (p: {
      externalId: string;
      amount: number;
      provider: PaylinkerInvoice['provider'];
    }) => {
      const inv: PaylinkerInvoice = {
        id: `inv-e2e-${OWNER_TG}-${++seq}`,
        externalId: p.externalId,
        status: 'PENDING',
        provider: p.provider,
        amount: p.amount,
        payUrl: p.provider === 'PAYNET' ? null : `https://pay.test/${seq}`,
        accountNumber: String(1000 + seq),
        underReview: false,
        paidAt: null,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      invoices.set(p.externalId, inv);
      return inv;
    },
  ),
  getInvoiceByExternalId: vi.fn(
    async (externalId: string) => invoices.get(externalId) ?? null,
  ),
  cancelInvoice: vi.fn(),
};
const fakeBot = { sendMessage: vi.fn(async () => true) };

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let ownerToken: string;
  let otherToken: string;
  let ownerId: string;
  let pricing: PricingService;
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

  /** Paylinker'ning o'zi kabi: `sha256=HMAC(secret, "<ts>.<xom tana>")`. Ichki sir YO'Q. */
  function webhook(
    event: string,
    data: object,
    opts: { secret?: string; ts?: number } = {},
  ) {
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event, created: ts, data });
    const sig = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
      .update(`${ts}.${body}`)
      .digest('hex');
    return http()
      .post('/api/payments/paylinker/webhook')
      .set('content-type', 'application/json')
      .set('X-Paylinker-Event', event)
      .set('X-Paylinker-Timestamp', String(ts))
      .set('X-Paylinker-Signature', `sha256=${sig}`)
      .send(body);
  }

  const paidPayload = (
    topupId: string,
    over: Partial<{ amount: number; status: string }> = {},
  ) => {
    const inv = invoices.get(topupId)!;
    return {
      invoiceId: inv.id,
      externalId: topupId,
      status: 'PAID',
      amount: inv.amount,
      account: null,
      ...over,
    };
  };

  const freeBalance = async () =>
    (
      await db.user.findUniqueOrThrow({ where: { id: ownerId } })
    ).balanceUzs.toNumber();

  const createTopup = (method: string, amountUzs: number, token = ownerToken) =>
    api(token).post('/api/payments/topups').send({ method, amountUzs });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaylinkerClient)
      .useValue(fakePaylinker)
      .overrideProvider(TelegramBotService)
      .useValue(fakeBot)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    pricing = app.get(PricingService);
    hadPricing = !!(await db.setting.findUnique({ where: { key: 'pricing' } }));
    savedSettings = await pricing.settings();
    await pricing.updateSettings(TEST_LIMITS);

    ownerToken = await login(OWNER_TG);
    otherToken = await login(OTHER_TG);
    ownerId = (
      await db.user.findUniqueOrThrow({
        where: { telegramId: BigInt(OWNER_TG) },
      })
    ).id;
  });

  afterAll(async () => {
    if (hadPricing) await pricing.updateSettings(savedSettings);
    else await db.setting.deleteMany({ where: { key: 'pricing' } });
    const users = await db.user.findMany({
      where: { telegramId: { in: [BigInt(OWNER_TG), BigInt(OTHER_TG)] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await db.topup.deleteMany({ where: { userId: { in: ids } } });
    await db.balanceEntry.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  beforeEach(() => vi.clearAllMocks());

  it('usullar va chegaralar', async () => {
    const res = await api(ownerToken).get('/api/payments/methods').expect(200);
    expect(res.body.methods.map((m: { code: string }) => m.code)).toEqual([
      'CLICK',
      'PAYME',
      'UZUM',
      'PAYNET',
    ]);
    expect(res.body).toMatchObject({
      minUzs: 10_000,
      maxUzs: 2_500_000,
      feePercent: 0,
    });
  });

  it("chegaradan tashqari summa va noma'lum usul — 400, invoice ochilmaydi", async () => {
    await createTopup('CLICK', 5_000).expect(400);
    await createTopup('CLICK', 3_000_000).expect(400);
    await createTopup('CLICK', 10_000.5).expect(400);
    await createTopup('STARS', 50_000).expect(400);
    expect(fakePaylinker.createInvoice).not.toHaveBeenCalled();
  });

  it("to'ldirish → imzolangan webhook → balans; takror webhook balansni oshirmaydi", async () => {
    const before = await freeBalance();
    const res = await createTopup('PAYME', 50_000).expect(201);
    expect(res.body).toMatchObject({
      method: 'PAYME',
      status: 'PENDING',
      creditUzs: 50_000,
      payUzs: 50_000,
    });
    expect(res.body.payUrl).toMatch(/^https:\/\/pay\.test\//);

    const call = fakePaylinker.createInvoice.mock
      .calls[0][0] as unknown as Record<string, unknown>;
    expect(call).toMatchObject({
      externalId: res.body.id,
      amount: 50_000,
      provider: 'PAYME',
    });
    expect(call.returnUrl).toContain(
      `/dashboard/balance/topup?topup=${res.body.id}`,
    );

    const first = await webhook(
      'invoice.paid',
      paidPayload(res.body.id),
    ).expect(200);
    expect(first.body).toEqual({ ok: true, result: 'credited' });
    expect(await freeBalance()).toBe(before + 50_000);

    const again = await webhook(
      'invoice.paid',
      paidPayload(res.body.id),
    ).expect(200);
    expect(again.body.result).toBe('duplicate');
    expect(await freeBalance()).toBe(before + 50_000);

    const topup = await api(ownerToken)
      .get(`/api/payments/topups/${res.body.id}`)
      .expect(200);
    expect(topup.body).toMatchObject({ status: 'PAID' });
    expect(topup.body.paidAt).toBeTruthy();

    const entries = await db.balanceEntry.findMany({
      where: { userId: ownerId, source: 'PAYLINKER' },
    });
    expect(
      entries.filter((e) => e.externalId === invoices.get(res.body.id)!.id),
    ).toHaveLength(1);
    // Mijozga bitta xabar — takror webhook ikkinchisini yubormaydi
    expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("ikki marta bosilsa — o'sha to'ldirish qaytadi, yangi invoice ochilmaydi", async () => {
    const a = await createTopup('CLICK', 20_000).expect(201);
    const b = await createTopup('CLICK', 20_000).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(fakePaylinker.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('Paynet: ilova havolasi hisob raqami va summa bilan quriladi', async () => {
    const res = await createTopup('PAYNET', 30_000).expect(201);
    const inv = invoices.get(res.body.id)!;
    expect(res.body.accountNumber).toBe(inv.accountNumber);
    expect(res.body.payUrl).toBe(
      `https://app.paynet.uz/?m=54304&c=${inv.accountNumber}&a=30000`,
    );
  });

  it("imzosiz, boshqa kalit bilan yoki eski webhook — 401, balans o'zgarmaydi", async () => {
    const res = await createTopup('UZUM', 40_000).expect(201);
    const before = await freeBalance();

    await http()
      .post('/api/payments/paylinker/webhook')
      .send(paidPayload(res.body.id))
      .expect(401);
    await webhook('invoice.paid', paidPayload(res.body.id), {
      secret: 'whsec_wrong',
    }).expect(401);
    await webhook('invoice.paid', paidPayload(res.body.id), {
      ts: Math.floor(Date.now() / 1000) - 2 * 86400,
    }).expect(401);

    expect(await freeBalance()).toBe(before);
  });

  it("kam to'langan — balansga yozilmaydi, to'ldirish FAILED", async () => {
    const res = await createTopup('PAYME', 60_000).expect(201);
    const before = await freeBalance();
    const r = await webhook(
      'invoice.paid',
      paidPayload(res.body.id, { amount: 59_000 }),
    ).expect(200);
    expect(r.body.result).toBe('underpaid');
    expect(await freeBalance()).toBe(before);
    const t = await db.topup.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(t).toMatchObject({ status: 'FAILED' });
  });

  it("muddati o'tgan webhook → EXPIRED; noma'lum externalId → 200", async () => {
    const res = await createTopup('PAYME', 70_000).expect(201);
    await webhook(
      'invoice.expired',
      paidPayload(res.body.id, { status: 'EXPIRED' }),
    ).expect(200);
    expect(
      (await db.topup.findUniqueOrThrow({ where: { id: res.body.id } })).status,
    ).toBe('EXPIRED');

    const r = await webhook('invoice.paid', {
      invoiceId: 'inv-x',
      externalId: 'not-ours',
      status: 'PAID',
      amount: 1000,
    }).expect(200);
    expect(r.body.result).toBe('unknown');
  });

  it("webhook kelmasa — so'rov Paylinker'dan oladi; xavf tekshiruvidagisi balansga yozilmaydi", async () => {
    const res = await createTopup('CLICK', 80_000).expect(201);
    const before = await freeBalance();
    // So'rov faqat 15 soniyadan keyin Paylinker'ga chiqadi
    await db.topup.update({
      where: { id: res.body.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const inv = invoices.get(res.body.id)!;
    invoices.set(res.body.id, { ...inv, status: 'PAID', underReview: true });
    const held = await api(ownerToken)
      .get(`/api/payments/topups/${res.body.id}`)
      .expect(200);
    expect(held.body.status).toBe('PENDING');
    expect(await freeBalance()).toBe(before);

    invoices.set(res.body.id, { ...inv, status: 'PAID', underReview: false });
    const paid = await api(ownerToken)
      .get(`/api/payments/topups/${res.body.id}`)
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(await freeBalance()).toBe(before + 80_000);
  });

  it("boshqa mijozning to'ldirishi ko'rinmaydi", async () => {
    const res = await createTopup('PAYME', 15_000).expect(201);
    await api(otherToken)
      .get(`/api/payments/topups/${res.body.id}`)
      .expect(404);
    const list = await api(otherToken).get('/api/payments/topups').expect(200);
    expect(list.body.topups).toEqual([]);
  });

  it("Paylinker javob bermasa — 502, to'ldirish FAILED", async () => {
    fakePaylinker.createInvoice.mockRejectedValueOnce(
      new PaylinkerError('NETWORK_ERROR'),
    );
    await createTopup('PAYME', 90_000).expect(502);
    const t = await db.topup.findFirstOrThrow({
      where: { userId: ownerId, creditUzs: 90_000 },
    });
    expect(t).toMatchObject({ status: 'FAILED', error: 'NETWORK_ERROR' });
  });
});
