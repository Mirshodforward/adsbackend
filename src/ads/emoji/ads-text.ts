/**
 * Telegram Ads matnidagi premium (custom) emoji formati:
 *
 *   ![⭐](tg://emoji?id=5386358072627184204)
 *
 * Mijoz kabinetda oddiy matn + emoji entitylari (UTF-16 offsetlar) yuboradi,
 * Telegram'ga shu kodlangan matn ketadi. Ko'rsatishda teskari yo'l: matn
 * ichidagi belgilar oddiy emoji sifatida (yoki rasm bilan) chiqariladi.
 *
 * ⚠️ Offsetlar UTF-16 kod birligida (JS `string.length` bilan bir xil):
 * surrogat juftlikli emoji (🔥) uzunligi 2. `slice` ishlatiladi, `[...str]` emas.
 */

export interface EmojiEntity {
  offset: number;
  length: number;
  /** Telegram custom_emoji_id — faqat raqamlar. */
  id: string;
}

export const ADS_EMOJI_RE = /!\[([^\]\n]{1,16})\]\(tg:\/\/emoji\?id=(\d{5,40})\)/g;

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Bitta grafema va u emoji (rasmli belgi) bo'lsa — `true`. */
export function isSingleEmoji(s: string): boolean {
  if (!s) return false;
  let count = 0;
  for (const _ of graphemes.segment(s)) if (++count > 1) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(s);
}

export class AdsTextError extends Error {
  constructor(readonly code: 'RANGE' | 'NOT_EMOJI' | 'OVERLAP' | 'TOO_MANY') {
    super(code);
  }
}

export const MAX_CUSTOM_EMOJI = 10;

/** Oddiy matn + entitylar → Telegram Ads formati. Xato bo'lsa `AdsTextError`. */
export function encodeAdsText(text: string, entities: EmojiEntity[] = []): string {
  if (!entities.length) return text;
  if (entities.length > MAX_CUSTOM_EMOJI) throw new AdsTextError('TOO_MANY');
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.offset < cursor) throw new AdsTextError('OVERLAP');
    if (e.length < 1 || e.offset + e.length > text.length)
      throw new AdsTextError('RANGE');
    const ch = text.slice(e.offset, e.offset + e.length);
    if (!isSingleEmoji(ch)) throw new AdsTextError('NOT_EMOJI');
    out += text.slice(cursor, e.offset) + `![${ch}](tg://emoji?id=${e.id})`;
    cursor = e.offset + e.length;
  }
  return out + text.slice(cursor);
}

/** Telegram Ads formati → oddiy matn + entitylar (UTF-16 offsetlar). */
export function decodeAdsText(ads: string): {
  text: string;
  entities: EmojiEntity[];
} {
  const src = String(ads ?? '');
  const entities: EmojiEntity[] = [];
  let out = '';
  let last = 0;
  for (const m of src.matchAll(ADS_EMOJI_RE)) {
    out += src.slice(last, m.index);
    const ch = m[1];
    entities.push({ offset: out.length, length: ch.length, id: m[2] });
    out += ch;
    last = m.index + m[0].length;
  }
  return { text: out + src.slice(last), entities };
}

/** Faqat ko'rinadigan matn (bildirishnoma, sarlavha, qidiruv uchun). */
export const stripAdsText = (ads: string): string =>
  String(ads ?? '').replace(ADS_EMOJI_RE, '$1');

export const countCustomEmoji = (ads: string): number =>
  [...String(ads ?? '').matchAll(ADS_EMOJI_RE)].length;

/**
 * Telegram ba'zan matndagi emojini `\u2b50` ko'rinishida (literal backslash-u)
 * qaytaradi. Bazaga va mijozga toza matn yozamiz.
 */
export function unescapeUnicode(s: string): string {
  if (!s.includes('\\u')) return s;
  return s.replace(/((?:\\u[0-9a-fA-F]{4})+)/g, (run) =>
    run
      .split('\\u')
      .filter(Boolean)
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join(''),
  );
}

/** Narx ko'paytuvchilari (jonli o'lchov, 2026-10-24): minimal CPM × (1 + yig'indi). */
export const CPM_EXTRA = { emoji: 0.5, userpic: 0.3 } as const;

export const cpmFactor = (opts: { emoji?: boolean; userpic?: boolean }) =>
  1 + (opts.emoji ? CPM_EXTRA.emoji : 0) + (opts.userpic ? CPM_EXTRA.userpic : 0);
