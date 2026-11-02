import { normalizeUsername, packageUzs, starsUnitUzs } from './shop-pricing.js';

describe("do'kon narxlari", () => {
  it('1 Star: hamkor narxi × kurs × ustama, butun so\'mga yuqoriga', () => {
    // 0.0153 × 12 250 × 1.17 = 219.28… → 220 (StarsPaymee bilan bir xil)
    expect(starsUnitUzs(0.0153, 12_250, 17)).toBe(220);
    // aniq butun son yuqoriga siljimaydi: 0.015 × 12 250 = 183.75 → 184; 0.016 × 12 500 = 200 → 200
    expect(starsUnitUzs(0.015, 12_250, 0)).toBe(184);
    expect(starsUnitUzs(0.016, 12_500, 0)).toBe(200);
  });

  it('Premium va sovg\'a — 100 so\'mgacha yuqoriga', () => {
    expect(packageUzs(12, 12_250, 9)).toBe(160_300); // 160 230 → 160 300
    expect(packageUzs(0.2475, 12_250, 48)).toBe(4_500); // 4 486.99 → 4 500
    expect(packageUzs(16, 12_500, 0)).toBe(200_000); // aniq qiymat o'zgarmaydi
  });

  it('username: @, t.me/ va bo\'sh joylar tozalanadi; noto\'g\'risi — null', () => {
    expect(normalizeUsername('@durov')).toBe('durov');
    expect(normalizeUsername(' https://t.me/Durov_Bot ')).toBe('Durov_Bot');
    expect(normalizeUsername('t.me/abc')).toBe(null); // protokolsiz t.me — username emas
    expect(normalizeUsername('1user')).toBe(null);
    expect(normalizeUsername('ab')).toBe(null);
    expect(normalizeUsername('user name')).toBe('user');
    expect(normalizeUsername('a'.repeat(33))).toBe(null);
  });
});
