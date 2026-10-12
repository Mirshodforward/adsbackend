import {
  accountContext,
  evaluateAd,
  isCoolingDown,
  RULES,
  type AdState,
} from './rules.js';

/** Haqiqiy e'lonlar asosida (2026-10-12 holati). */
const base: AdState = {
  adId: 20,
  status: 'active',
  isPaused: false,
  actionType: 'start_bot',
  currency: 'TON',
  cpm: 0.18,
  remainingBudget: 0.02836,
  dailyBudgetLimit: null,
  dailySpent: null,
  views: 10954,
  clicks: 205,
  actions: 88,
  spent: 1.97164,
  spentLast24h: 0.18594,
  viewsLast6h: 260,
  viewsSame6hYesterday: 250,
};

const history: AdState[] = [
  base,
  {
    ...base,
    adId: 21,
    cpm: 0.23,
    views: 12380,
    clicks: 209,
    actions: 105,
    spent: 2.84686,
  },
  {
    ...base,
    adId: 23,
    status: 'stopped',
    views: 30435,
    clicks: 234,
    actions: 44,
    spent: 7,
  },
  {
    ...base,
    adId: 25,
    status: 'stopped',
    views: 5556,
    clicks: 57,
    actions: 8,
    spent: 1,
  },
  {
    ...base,
    adId: 19,
    status: 'stopped',
    views: 5557,
    clicks: 1635,
    actions: 0,
    spent: 1,
  },
];
const ctx = accountContext(history, 4.85726, 0.5);

describe('accountContext', () => {
  it("CPA medianasi faqat yetarli harakatli e'lonlardan", () => {
    // #20 0.0224, #21 0.0271, #23 0.159, #25 0.125 — #19 (0 harakat) chiqarib tashlanadi
    expect(ctx.medianCpa).toBeCloseTo((0.0271 + 0.125) / 2, 3);
  });
});

describe('evaluateAd', () => {
  it("budjet 12 soatga yetmasa — 3 kunlik sarf qo'shishni tavsiya qiladi", () => {
    const [rec, ...rest] = evaluateAd(base, ctx);
    expect(rest).toHaveLength(0);
    expect(rec.kind).toBe('ADD_BUDGET');
    expect(rec.change).toEqual({ amount: 0.56 });
    expect(rec.reason).toContain('~3 soatga');
    expect(rec.snapshot).toEqual({
      cpm: 0.18,
      isPaused: false,
      remainingBudget: 0.02836,
    });
  });

  it("budjet yetarli bo'lsa tavsiya yo'q", () => {
    const rich = { ...base, remainingBudget: 0.5 };
    expect(evaluateAd(rich, ctx)).toEqual([]);
  });

  it("hisobdagi puldan ortiq qo'shishni tavsiya qilmaydi", () => {
    const [rec] = evaluateAd(base, { ...ctx, availableBudget: 0.3 });
    expect(rec.change).toEqual({ amount: 0.3 });
    expect(rec.reason).toContain('hisobda faqat 0.30 TON');
  });

  it("hisob bo'sh bo'lsa budjet tavsiyasi yo'q", () => {
    expect(evaluateAd(base, { ...ctx, availableBudget: 0.004 })).toEqual([]);
  });

  it("harakatsiz ko'p bosish — to'xtatish (#19 holati)", () => {
    const junk = { ...base, clicks: 1635, actions: 0, spent: 1 };
    const recs = evaluateAd(junk, ctx);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      kind: 'PAUSE',
      change: { is_paused: true },
    });
    expect(recs[0].reason).toContain('1635 ta bosish');
  });

  it("CPA medianadan 2 baravar qimmat — to'xtatish, budjet tavsiya qilinmaydi", () => {
    const pricey = { ...base, actions: 4, spent: 2 }; // CPA 0.5
    const recs = evaluateAd(pricey, ctx);
    expect(recs.map((r) => r.kind)).toEqual(['PAUSE']);
  });

  it('kam sarfda xulosa qilmaydi', () => {
    const early = {
      ...base,
      clicks: 150,
      actions: 0,
      spent: RULES.minSpentForVerdict - 0.01,
      remainingBudget: 1,
    };
    expect(evaluateAd(early, ctx)).toEqual([]);
  });

  it("harakat turi yo'q e'lon CTR bo'yicha baholanadi", () => {
    const channel = {
      ...base,
      actionType: null,
      views: 10000,
      clicks: 10,
      remainingBudget: 1,
    };
    expect(evaluateAd(channel, ctx)[0]?.kind).toBe('PAUSE');
  });

  it("kechagidan keskin kam ko'rsatilsa — CPM'ni 10% oshirish", () => {
    const starved = {
      ...base,
      remainingBudget: 1,
      viewsLast6h: 10,
      viewsSame6hYesterday: 300,
    };
    const recs = evaluateAd(starved, ctx);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: 'RAISE_CPM', change: { cpm: 0.2 } });
    expect(recs[0].reason).toContain('97% kam');
  });

  it('CPM chegarasidan oshirmaydi', () => {
    const starved = {
      ...base,
      cpm: 0.48,
      remainingBudget: 1,
      viewsLast6h: 10,
      viewsSame6hYesterday: 300,
    };
    expect(evaluateAd(starved, ctx)).toEqual([]);
  });

  it("kechagi tarix bo'lmasa yoki kunlik limitga yetgan bo'lsa CPM tegilmaydi", () => {
    const noHistory = {
      ...base,
      remainingBudget: 1,
      viewsLast6h: 0,
      viewsSame6hYesterday: null,
    };
    const capped = {
      ...base,
      remainingBudget: 1,
      viewsLast6h: 0,
      viewsSame6hYesterday: 300,
      dailyBudgetLimit: 0.2,
      dailySpent: 0.2,
    };
    expect(evaluateAd(noHistory, ctx)).toEqual([]);
    expect(evaluateAd(capped, ctx)).toEqual([]);
  });

  it("faol bo'lmagan yoki pauzadagi e'lonni baholamaydi", () => {
    expect(evaluateAd({ ...base, status: 'stopped' }, ctx)).toEqual([]);
    expect(evaluateAd({ ...base, isPaused: true }, ctx)).toEqual([]);
  });
});

describe('isCoolingDown', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const ago = (hours: number) => new Date(now - hours * 3600_000);

  it('rad etilgani 24 soat, xatosi 1 soat qayta taklif qilinmaydi', () => {
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'DISMISSED', decidedAt: ago(23) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(true);
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'DISMISSED', decidedAt: ago(25) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(false);
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'FAILED', decidedAt: ago(0.5) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(true);
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'FAILED', decidedAt: ago(2) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(false);
  });

  it("boshqa tur yoki qo'llangan/eskirgan tavsiya to'sqinlik qilmaydi", () => {
    expect(
      isCoolingDown(
        [{ kind: 'PAUSE', status: 'DISMISSED', decidedAt: ago(1) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(false);
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'APPLIED', decidedAt: ago(1) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(false);
    expect(
      isCoolingDown(
        [{ kind: 'ADD_BUDGET', status: 'EXPIRED', decidedAt: ago(1) }],
        'ADD_BUDGET',
        now,
      ),
    ).toBe(false);
  });
});
