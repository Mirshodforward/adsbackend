import { createHmac } from 'node:crypto';
import { PaylinkerClient, PaylinkerError } from './paylinker.client.js';
import { verifyPaylinkerSignature } from './paylinker-signature.js';
import { buildPaynetAppUrl } from './paynet-link.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('verifyPaylinkerSignature', () => {
  const secret = 'whsec_test_0123456789abcdef';
  const body = '{"event":"invoice.paid","data":{"externalId":"t1"}}';
  const now = 1_790_000_000;
  const sign = (ts: number, raw = body, key = secret) =>
    'sha256=' + createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex');

  it('Paylinker imzosini qabul qiladi (satr va Buffer)', () => {
    const signature = sign(now);
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature,
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(true);
    expect(
      verifyPaylinkerSignature({
        rawBody: Buffer.from(body),
        signature,
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(true);
  });

  it('`sha256=` prefiksisiz ham', () => {
    const signature = sign(now).slice('sha256='.length);
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature,
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(true);
  });

  it("tana bir bayt o'zgarsa — rad", () => {
    expect(
      verifyPaylinkerSignature({
        rawBody: body + ' ',
        signature: sign(now),
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('boshqa kalit — rad', () => {
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: sign(now, body, 'whsec_other'),
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it("vaqt imzoga kiradi — boshqa vaqt bilan qayta yuborib bo'lmaydi", () => {
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: sign(now),
        timestamp: String(now + 1),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it('24 soatdan eski — rad (replay)', () => {
    const old = now - 24 * 3600 - 1;
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: sign(old),
        timestamp: String(old),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
  });

  it("imzo, vaqt yoki kalit yo'q — rad", () => {
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: '',
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: sign(now),
        timestamp: '',
        secret,
        nowSec: now,
      }),
    ).toBe(false);
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: sign(now),
        timestamp: String(now),
        secret: '',
        nowSec: now,
      }),
    ).toBe(false);
  });

  it("noto'g'ri formatdagi imzo xato tashlamaydi, rad qiladi", () => {
    expect(
      verifyPaylinkerSignature({
        rawBody: body,
        signature: 'sha256=abc',
        timestamp: String(now),
        secret,
        nowSec: now,
      }),
    ).toBe(false);
  });
});

describe('buildPaynetAppUrl', () => {
  it("hisob va summa oldindan to'ldirilgan havola", () => {
    expect(buildPaynetAppUrl('54304', '4321', 50_000)).toBe(
      'https://app.paynet.uz/?m=54304&c=4321&a=50000',
    );
  });
  it("summa yaxlitlanadi, nol bo'lsa qo'yilmaydi", () => {
    expect(buildPaynetAppUrl('54304', '7', 1234.6)).toBe(
      'https://app.paynet.uz/?m=54304&c=7&a=1235',
    );
    expect(buildPaynetAppUrl('54304', '7', 0)).toBe(
      'https://app.paynet.uz/?m=54304&c=7',
    );
  });
});

describe('PaylinkerClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new PaylinkerClient({
    apiKey: 'pk_test_key',
    baseUrl: 'https://pl.test/',
  });
  const invoice = {
    id: 'inv-1',
    externalId: 't1',
    status: 'PENDING',
    provider: 'PAYME',
    amount: 50000,
    payUrl: 'https://checkout.paycom.uz/abc',
    accountNumber: '4321',
    underReview: false,
    paidAt: null,
    expiresAt: '2026-10-13T10:30:00.000Z',
    createdAt: '2026-10-13T10:00:00.000Z',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('invoice yaratadi: Bearer kalit, JSON body, data qaytaradi', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: invoice }));
    const res = await client.createInvoice({
      externalId: 't1',
      amount: 50000,
      provider: 'PAYME',
    });
    expect(res).toEqual(invoice);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pl.test/v1/invoices');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer pk_test_key',
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      externalId: 't1',
      amount: 50000,
      provider: 'PAYME',
    });
  });

  it('Paylinker xatosi kod va HTTP holati bilan', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          success: false,
          error: {
            code: 'provider_not_configured',
            message: 'PAYNET sozlanmagan',
          },
        },
        400,
      ),
    );
    const err = await client
      .createInvoice({ externalId: 't1', amount: 1, provider: 'PAYNET' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PaylinkerError);
    expect(err).toMatchObject({
      code: 'provider_not_configured',
      status: 400,
      message: 'PAYNET sozlanmagan',
    });
  });

  it('by-external: 404 → null, externalId kodlanadi', async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, error: { code: 'not_found' } }, 404),
    );
    expect(await client.getInvoiceByExternalId('a/b')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pl.test/v1/invoices/by-external/a%2Fb',
    );
  });

  it("tarmoq xatosi — NETWORK_ERROR, JSON bo'lmagan javob — HTTP_<status>", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      client.createInvoice({ externalId: 't', amount: 1, provider: 'CLICK' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    fetchMock.mockResolvedValueOnce(
      new Response('<html>502</html>', { status: 502 }),
    );
    await expect(
      client.createInvoice({ externalId: 't', amount: 1, provider: 'CLICK' }),
    ).rejects.toMatchObject({ code: 'HTTP_502' });
  });

  it("kalit yo'q — tarmoqqa chiqmasdan NOT_CONFIGURED", async () => {
    const empty = new PaylinkerClient({ apiKey: '' });
    expect(empty.configured).toBe(false);
    await expect(
      empty.createInvoice({ externalId: 't', amount: 1, provider: 'CLICK' }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
