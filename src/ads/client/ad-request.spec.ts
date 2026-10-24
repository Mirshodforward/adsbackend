import type { Pricing } from '../../settings/pricing.service.js';
import {
  buildAdRequest,
  normalizePromoteUrl,
  normalizeUsername,
  type ClientAdInput,
} from './ad-request.js';

const pricing: Pricing = {
  commissionPercent: 10,
  minBudgetUzs: 30_000,
  minCpmTon: 0.1,
  manualUzsPerTon: null,
  topupMinUzs: 50_000,
  topupMaxUzs: 10_000_000,
  topupFeePercent: 0,
  uzsPerTon: 20_000, // 1 TON = 20 000 so'm (xizmat haqi bilan)
  marketUzsPerTon: 18_181.82,
  tonUsd: 1.5,
  usdUzs: 12_121.21,
  minCpmUzs: 2_000,
  rateUpdatedAt: '2026-10-13T00:00:00Z',
  stale: false,
  tonSource: 'tonapi',
  usdSource: 'manual',
  manualUsdUzs: 12_250,
};

const input: ClientAdInput = {
  promoteUrl: '@GemPayUz_bot',
  placement: 'channel_post',
  text: "11 900 so'mga 60 UC!",
  target: {
    type: 'users',
    countryCodes: ['UZ'],
    languageCodes: ['uz', 'ru'],
    topicIds: [48],
    excludeTopicIds: [2],
  },
  budgetUzs: 100_000,
  cpmUzs: 4_000,
};

describe('normalizePromoteUrl', () => {
  it("@username va t.me havolalarini to'liq URL qiladi", () => {
    expect(normalizePromoteUrl('@GemPayUz_bot')).toEqual({
      url: 'https://t.me/GemPayUz_bot',
      telegram: true,
    });
    expect(normalizePromoteUrl('t.me/kanal/15')).toEqual({
      url: 'https://t.me/kanal/15',
      telegram: true,
    });
    expect(normalizePromoteUrl('http://telegram.me/bot?start=ads')).toEqual({
      url: 'https://t.me/bot?start=ads',
      telegram: true,
    });
    expect(normalizePromoteUrl('https://shop.uz/aksiya')).toEqual({
      url: 'https://shop.uz/aksiya',
      telegram: false,
    });
  });

  it("noto'g'ri havolani rad etadi", () => {
    expect(normalizePromoteUrl('salom')).toBeNull();
    expect(normalizePromoteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePromoteUrl('https://t.me/')).toBeNull();
    expect(
      normalizePromoteUrl(`https://shop.uz/${'a'.repeat(260)}`),
    ).toBeNull();
  });
});

describe('normalizeUsername', () => {
  it("turli ko'rinishlarni @username qiladi", () => {
    expect(normalizeUsername('durov')).toBe('@durov');
    expect(normalizeUsername('@durov')).toBe('@durov');
    expect(normalizeUsername('https://t.me/durov/123')).toBe('@durov');
    expect(normalizeUsername('ab')).toBeNull();
  });
});

describe('buildAdRequest', () => {
  it("so'mni TON'ga aylantiradi va to'liq so'rov yasaydi", () => {
    const r = buildAdRequest(input, pricing, 12345678);
    expect(r).toMatchObject({
      ok: true,
      amountUzs: 100_000,
      amountTon: 5,
      request: {
        promote_url: 'https://t.me/GemPayUz_bot',
        text: "11 900 so'mga 60 UC!",
        cpm: 0.2,
        initial_budget: 5,
        placement: 'channel_post',
        target: {
          type: 'users',
          country_codes: ['UZ'],
          language_codes: ['uz', 'ru'],
          topic_ids: [48],
          exclude_topic_ids: [2],
        },
      },
    });
    expect(r.ok && r.request.title).toBe("OT 12345678 · 11 900 so'mga 60 UC!");
  });

  it("budjetni pastga yaxlitlaydi — mijozga to'lanmagan TON berilmaydi", () => {
    const r = buildAdRequest({ ...input, budgetUzs: 50_999 }, pricing, 1);
    expect(r.ok && r.amountTon).toBe(2.54);
  });

  it("kurs eskirgan bo'lsa pul amali bajarilmaydi", () => {
    expect(buildAdRequest(input, { ...pricing, stale: true }, 1)).toMatchObject(
      { ok: false },
    );
  });

  it("minimal budjet, CPM va 1000 ko'rish chegaralari", () => {
    expect(buildAdRequest({ ...input, budgetUzs: 29_000 }, pricing, 1)).toEqual(
      { ok: false, error: "Minimal budjet — 30 000 so'm" },
    );
    expect(
      buildAdRequest({ ...input, cpmUzs: 1_500 }, pricing, 1),
    ).toMatchObject({ ok: false });
    expect(
      buildAdRequest(
        { ...input, budgetUzs: 30_000, cpmUzs: 40_000 },
        pricing,
        1,
      ),
    ).toMatchObject({
      ok: false,
      error: "Budjet kamida 1000 ta ko'rishga yetishi kerak",
    });
  });

  it('joylashuvga mos kelmagan auditoriyani rad etadi', () => {
    const r = buildAdRequest(
      {
        ...input,
        placement: 'bot_banner',
        target: { type: 'channels', channels: ['@kanal'] },
      },
      pricing,
      1,
    );
    expect(r).toMatchObject({ ok: false });
  });

  it("kanallar ro'yxatini @username ko'rinishida va takrorsiz yuboradi", () => {
    const r = buildAdRequest(
      {
        ...input,
        target: {
          type: 'channels',
          channels: ['durov', '@durov', 't.me/tdmnewsuz'],
        },
      },
      pricing,
      1,
    );
    expect(r.ok && r.request.target).toEqual({
      type: 'channels',
      channel_ids: ['@durov', '@tdmnewsuz'],
    });
  });

  it('sayt reklamasi uchun nom shart, tugma faqat saytga', () => {
    const site = { ...input, promoteUrl: 'https://shop.uz' };
    expect(buildAdRequest(site, pricing, 1)).toEqual({
      ok: false,
      error: 'Sayt reklamasi uchun sayt nomini kiriting',
    });
    const ok = buildAdRequest(
      { ...site, websiteName: 'Shop.uz', button: 'buy' },
      pricing,
      1,
    );
    expect(ok.ok && ok.request).toMatchObject({
      website_name: 'Shop.uz',
      button: 'buy',
    });
    const tg = buildAdRequest({ ...input, button: 'buy' }, pricing, 1);
    expect(tg.ok && tg.request.button).toBeUndefined();
  });

  it("bir foydalanuvchiga kunlik ko'rsatish chastotasi faqat 1 dan katta bo'lsa yuboriladi", () => {
    const def = buildAdRequest({ ...input, impressionFrequency: 1 }, pricing, 1);
    expect(def.ok && def.request.impression_frequency).toBeUndefined();
    const twice = buildAdRequest({ ...input, impressionFrequency: 2 }, pricing, 1);
    expect(twice.ok && twice.request.impression_frequency).toBe(2);
  });

  it("kunlik limit TON'ga aylanadi va 1000 ko'rishdan kam bo'lmaydi", () => {
    const r = buildAdRequest({ ...input, dailyLimitUzs: 20_000 }, pricing, 1);
    expect(r.ok && r.request.daily_budget_limit).toBe(1);
    expect(
      buildAdRequest({ ...input, dailyLimitUzs: 2_000 }, pricing, 1),
    ).toMatchObject({ ok: false });
  });

  it("qidiruv reklamasida matn ixtiyoriy, kalit so'zlar uzatiladi", () => {
    const r = buildAdRequest(
      {
        ...input,
        placement: 'search_result',
        text: '',
        target: { type: 'search', queries: [' uc narxi ', 'pubg uc'] },
      },
      pricing,
      1,
    );
    expect(r.ok && r.request).toMatchObject({
      target: { type: 'search', search_queries: ['uc narxi', 'pubg uc'] },
    });
    expect(r.ok && r.request.text).toBeUndefined();
  });
});

describe('buildAdRequest — premium emoji va avatar', () => {
  const star = { offset: 0, length: 1, id: '5190768311394130762' };

  it("matnni Telegram Ads formatiga kodlaydi va minimal narxni +50% qiladi", () => {
    const emojiInput: ClientAdInput = {
      ...input,
      text: "⭐ 11 900 so'mga 60 UC!",
      emoji: [star],
      cpmUzs: 2_000, // minimal (0.1 TON) — emoji bilan kam
    };
    const tooCheap = buildAdRequest(emojiInput, pricing, 10000001);
    expect(tooCheap.ok).toBe(false);
    if (!tooCheap.ok) expect(tooCheap.error).toMatch(/premium emoji/);

    const built = buildAdRequest({ ...emojiInput, cpmUzs: 3_000 }, pricing, 10000001);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.text).toBe(
      "![⭐](tg://emoji?id=5190768311394130762) 11 900 so'mga 60 UC!",
    );
    // Sarlavha oddiy matndan — markup'siz.
    expect(built.request.title).toContain("⭐ 11 900 so'mga 60 UC!");
    expect(built.request.show_userpic).toBeUndefined();
  });

  it("boshidagi bo'sh joy offsetlarni buzmaydi (controller trim qilmaydi)", () => {
    const built = buildAdRequest(
      { ...input, text: '  ⭐ Salom', emoji: [{ offset: 2, length: 1, id: '123456' }], cpmUzs: 3_000 },
      pricing,
      1,
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.request.text).toBe('![⭐](tg://emoji?id=123456) Salom');
  });

  it("kodlangan matn 160 dan oshsa — tushunarli xato", () => {
    const text = 'Sinov matni '.repeat(10).trim() + ' ⭐⭐⭐';
    const base = text.length - 3;
    const built = buildAdRequest(
      {
        ...input,
        text,
        emoji: [0, 1, 2].map((i) => ({ offset: base + i, length: 1, id: '5190768311394130762' })),
        cpmUzs: 4_000,
      },
      pricing,
      1,
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/160 belgidan oshdi/);
  });

  it("avatar faqat Telegram havolasida va +30% minimal narx", () => {
    const site = buildAdRequest(
      { ...input, promoteUrl: 'https://shop.uz', websiteName: 'Shop', showUserpic: true, cpmUzs: 2_000 },
      pricing,
      1,
    );
    expect(site.ok).toBe(true);
    if (site.ok) expect(site.request.show_userpic).toBeUndefined();

    const cheap = buildAdRequest({ ...input, showUserpic: true, cpmUzs: 2_000 }, pricing, 1);
    expect(cheap.ok).toBe(false);
    const ok = buildAdRequest({ ...input, showUserpic: true, cpmUzs: 2_600 }, pricing, 1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.request.show_userpic).toBe(true);
  });
});
