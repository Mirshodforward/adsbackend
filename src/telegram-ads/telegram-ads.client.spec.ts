import { TelegramAdsClient, TelegramAdsError } from './telegram-ads.client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('TelegramAdsClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new TelegramAdsClient({
    token: 'test-token',
    baseUrl: 'https://ads.test/',
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('Bearer token va JSON body bilan POST yuboradi, result qaytaradi', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, result: { ad_id: 7 } }));

    const ad = await client.increaseAdBudget({
      ad_id: 7,
      amount: 1.5,
      idempotency_key: 'k1',
    });

    expect(ad).toEqual({ ad_id: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ads.test/increaseAdBudget');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer test-token',
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      ad_id: 7,
      amount: 1.5,
      idempotency_key: 'k1',
    });
  });

  it("HTTP 200 bo'lsa ham ok:false ni xato qiladi", async () => {
    fetchMock.mockResolvedValue(
      json({ ok: false, error: 'MAIN_ACCOUNT_REQUIRED' }),
    );

    await expect(client.getCurrentAccount()).rejects.toMatchObject({
      name: 'TelegramAdsError',
      code: 'MAIN_ACCOUNT_REQUIRED',
      method: 'getCurrentAccount',
      status: 200,
    });
  });

  it("JSON bo'lmagan javobni HTTP_<status> xatosiga aylantiradi", async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502</html>', { status: 502 }),
    );

    await expect(client.getAdsList()).rejects.toMatchObject({
      code: 'HTTP_502',
      status: 502,
    });
  });

  it('tarmoq xatosini NETWORK_ERROR qiladi', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await client.getAdsList().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramAdsError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
