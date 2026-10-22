import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramLoginCheck } from './telegram-login.js';

/**
 * Telegram Mini App `initData` tekshiruvi:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   data_check_string = hash'dan boshqa BARCHA maydonlar (URL-decode qilingan),
 *                       kalit bo'yicha alifbo tartibida, "key=value", "\n" bilan
 *   secret_key        = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash              = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 *
 * Login Widget'dan farqi: kalit SHA256(token) emas, HMAC("WebAppData", token);
 * foydalanuvchi `user` maydonida JSON bo'lib keladi.
 */
export function verifyWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): TelegramLoginCheck {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: 'malformed' };
  }
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate)) return { ok: false, reason: 'malformed' };
  if (nowSec - authDate > maxAgeSec) return { ok: false, reason: 'expired' };

  let user: Record<string, unknown>;
  try {
    user = JSON.parse(params.get('user') ?? '') as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const id = String(user?.id ?? '');
  if (!/^\d+$/.test(id)) return { ok: false, reason: 'malformed' };

  const text = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v : null;
  return {
    ok: true,
    user: {
      id: BigInt(id),
      firstName: text(user.first_name) ?? '',
      lastName: text(user.last_name),
      username: text(user.username),
      photoUrl: text(user.photo_url),
      authDate,
    },
  };
}
