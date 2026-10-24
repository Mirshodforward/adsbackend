import { describe, expect, it } from 'vitest';
import {
  AdsTextError,
  countCustomEmoji,
  decodeAdsText,
  encodeAdsText,
  isSingleEmoji,
  stripAdsText,
} from './ads-text.js';

describe('ads-text', () => {
  it('kodlaydi: UTF-16 offsetlar, surrogat juftlik', () => {
    const text = '🔥 Chegirma ⭐ bugun';
    // 🔥 = 2 kod birligi, ⭐ = 1
    const out = encodeAdsText(text, [
      { offset: 0, length: 2, id: '111111' },
      { offset: 12, length: 1, id: '222222' },
    ]);
    expect(out).toBe(
      '![🔥](tg://emoji?id=111111) Chegirma ![⭐](tg://emoji?id=222222) bugun',
    );
    expect(countCustomEmoji(out)).toBe(2);
  });

  it('dekodlaydi va qaytadan kodlasa bir xil chiqadi', () => {
    const ads = 'Salom ![👍](tg://emoji?id=5368358072627184204)! Narx 10 000 so‘m';
    const { text, entities } = decodeAdsText(ads);
    expect(text).toBe('Salom 👍! Narx 10 000 so‘m');
    expect(entities).toEqual([
      { offset: 6, length: 2, id: '5368358072627184204' },
    ]);
    expect(encodeAdsText(text, entities)).toBe(ads);
    expect(stripAdsText(ads)).toBe(text);
  });

  it("noto'g'ri entitylarni rad etadi", () => {
    expect(() =>
      encodeAdsText('abc', [{ offset: 0, length: 1, id: '1' }]),
    ).toThrow(AdsTextError);
    expect(() =>
      encodeAdsText('⭐', [{ offset: 0, length: 5, id: '1' }]),
    ).toThrow('RANGE');
    expect(() =>
      encodeAdsText('🔥🔥', [
        { offset: 0, length: 2, id: '1' },
        { offset: 1, length: 2, id: '2' },
      ]),
    ).toThrow('OVERLAP');
    expect(() =>
      encodeAdsText(
        '⭐'.repeat(11),
        Array.from({ length: 11 }, (_, i) => ({ offset: i, length: 1, id: '1' })),
      ),
    ).toThrow('TOO_MANY');
  });

  it('emoji aniqlaydi', () => {
    expect(isSingleEmoji('⭐')).toBe(true);
    expect(isSingleEmoji('🔥')).toBe(true);
    expect(isSingleEmoji('❤️')).toBe(true);
    expect(isSingleEmoji('a')).toBe(false);
    expect(isSingleEmoji('⭐⭐')).toBe(false);
    expect(isSingleEmoji('')).toBe(false);
  });
});
