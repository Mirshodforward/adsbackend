import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebAppInitData } from './telegram-webapp.js';

const TOKEN = '123456789:AAE_test_token_xxxxxxxxxxxxxxxxxxxxxxx';

/** Telegram kabi initData yasash (hash — "WebAppData" kaliti bilan). */
function initData(fields: Record<string, string>, token = TOKEN) {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  const p = new URLSearchParams({ ...fields, hash });
  return p.toString();
}

const now = 1_760_000_000;
const user = JSON.stringify({
  id: 42,
  first_name: 'Ali',
  last_name: 'Valiyev',
  username: 'ali',
  photo_url: 'https://t.me/i/userpic/320/ali.jpg',
  language_code: 'uz',
});

describe('verifyWebAppInitData', () => {
  it("to'g'ri imzo — foydalanuvchi o'qiladi", () => {
    const r = verifyWebAppInitData(
      initData({ user, auth_date: String(now - 60), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc' }),
      TOKEN,
      3600,
      now,
    );
    expect(r).toMatchObject({
      ok: true,
      user: { id: 42n, firstName: 'Ali', lastName: 'Valiyev', username: 'ali', authDate: now - 60 },
    });
  });

  it("boshqa bot tokeni bilan imzo — rad", () => {
    const r = verifyWebAppInitData(
      initData({ user, auth_date: String(now) }, 'boshqa:token'),
      TOKEN,
      3600,
      now,
    );
    expect(r).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it("maydon o'zgartirilsa — rad", () => {
    const data = initData({ user, auth_date: String(now) });
    const tampered = data.replace('%22id%22%3A42', '%22id%22%3A43');
    expect(tampered).not.toBe(data);
    expect(verifyWebAppInitData(tampered, TOKEN, 3600, now).ok).toBe(false);
  });

  it('eskirgan — rad', () => {
    const r = verifyWebAppInitData(
      initData({ user, auth_date: String(now - 7200) }),
      TOKEN,
      3600,
      now,
    );
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it("hash yo'q yoki user JSON emas — malformed", () => {
    expect(verifyWebAppInitData('user=x&auth_date=1', TOKEN, 3600, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      verifyWebAppInitData(initData({ user: 'not-json', auth_date: String(now) }), TOKEN, 3600, now),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});
