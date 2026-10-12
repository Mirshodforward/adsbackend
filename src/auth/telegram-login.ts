import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  authDate: number;
}

export type TelegramLoginCheck =
  | { ok: true; user: TelegramUser }
  | { ok: false; reason: 'malformed' | 'bad_hash' | 'expired' };

/**
 * Telegram Login Widget ma'lumotini tekshiradi:
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 *   data_check_string = hash'dan boshqa BARCHA maydonlar, kalit bo'yicha
 *                       alifbo tartibida, "key=value" ko'rinishida, "\n" bilan
 *   secret_key        = SHA256(bot_token)
 *   hash              = hex(HMAC_SHA256(data_check_string, secret_key))
 *
 * Faqat ma'lum maydonlarni ajratib olmaymiz: Telegram yangi maydon qo'shsa,
 * u ham imzoga kiradi va tashlab yuborilsa tekshiruv yiqiladi.
 */
export function verifyTelegramLogin(
  data: Record<string, unknown>,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): TelegramLoginCheck {
  const { hash, ...fields } = data;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: 'malformed' };
  }

  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.some(([, v]) => typeof v !== 'string' && typeof v !== 'number')) {
    return { ok: false, reason: 'malformed' };
  }

  const checkString = entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value as string | number}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    return { ok: false, reason: 'bad_hash' };
  }

  // Imzo to'g'ri — maydonlar Telegram'dan kelgani aniq, endi qiymatlarni o'qiymiz.
  const id = String(fields.id ?? '');
  const authDate = Number(fields.auth_date);
  if (!/^\d+$/.test(id) || !Number.isInteger(authDate)) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowSec - authDate > maxAgeSec) {
    return { ok: false, reason: 'expired' };
  }

  const text = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v : null;
  return {
    ok: true,
    user: {
      id: BigInt(id),
      firstName: text(fields.first_name) ?? '',
      lastName: text(fields.last_name),
      username: text(fields.username),
      photoUrl: text(fields.photo_url),
      authDate,
    },
  };
}
