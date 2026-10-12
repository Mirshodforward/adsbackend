import { createHash, createHmac } from 'node:crypto';
import { verifyTelegramLogin } from './telegram-login.js';

const BOT_TOKEN = '123456789:AAUNIT_TEST_TOKEN_xxxxxxxxxxxxxxxxxxxxx';
const NOW = 1_760_000_000;
const DAY = 86_400;

/** Telegram hujjatidagi algoritm bo'yicha mustaqil imzolash. */
function sign(fields: Record<string, string | number>, token = BOT_TOKEN) {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return { ...fields, hash };
}

const widgetUser = {
  id: 8489944907,
  first_name: 'Abdulla',
  last_name: 'Qodiriy',
  username: 'abdulla',
  photo_url: 'https://t.me/i/userpic/320/abdulla.jpg',
  auth_date: NOW - 60,
};

describe('verifyTelegramLogin', () => {
  it("to'g'ri imzoni qabul qiladi va profilni qaytaradi", () => {
    const result = verifyTelegramLogin(sign(widgetUser), BOT_TOKEN, DAY, NOW);
    expect(result).toEqual({
      ok: true,
      user: {
        id: 8489944907n,
        firstName: 'Abdulla',
        lastName: 'Qodiriy',
        username: 'abdulla',
        photoUrl: 'https://t.me/i/userpic/320/abdulla.jpg',
        authDate: NOW - 60,
      },
    });
  });

  it("ixtiyoriy maydonlar bo'lmasa null qaytaradi", () => {
    const minimal = { id: 42, first_name: 'Ali', auth_date: NOW };
    const result = verifyTelegramLogin(sign(minimal), BOT_TOKEN, DAY, NOW);
    expect(result.ok && result.user).toMatchObject({
      id: 42n,
      lastName: null,
      username: null,
      photoUrl: null,
    });
  });

  it("noma'lum maydon ham imzoga kiradi", () => {
    const withExtra = sign({ ...widgetUser, allows_write_to_pm: 'true' });
    expect(verifyTelegramLogin(withExtra, BOT_TOKEN, DAY, NOW).ok).toBe(true);

    const stripped: Record<string, unknown> = { ...withExtra };
    delete stripped.allows_write_to_pm;
    expect(verifyTelegramLogin(stripped, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
  });

  it("o'zgartirilgan maydonni rad etadi", () => {
    const tampered = { ...sign(widgetUser), id: 1 };
    expect(verifyTelegramLogin(tampered, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
  });

  it('boshqa bot tokeni bilan imzolanganini rad etadi', () => {
    const foreign = sign(
      widgetUser,
      '987654321:AAFOREIGNBOTTOKENxxxxxxxxxxxxxxxxxx',
    );
    expect(verifyTelegramLogin(foreign, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
  });

  it('eskirgan auth_date ni rad etadi', () => {
    const old = sign({ ...widgetUser, auth_date: NOW - DAY - 1 });
    expect(verifyTelegramLogin(old, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it("hash yo'q yoki formati buzuq bo'lsa malformed", () => {
    expect(verifyTelegramLogin(widgetUser, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      verifyTelegramLogin({ ...widgetUser, hash: 'abc' }, BOT_TOKEN, DAY, NOW),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it("obyekt ko'rinishidagi qiymatni rad etadi", () => {
    const nested = { ...sign(widgetUser), extra: { a: 1 } };
    expect(verifyTelegramLogin(nested, BOT_TOKEN, DAY, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
