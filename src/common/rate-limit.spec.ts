import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RateLimitGuard, type RateLimitRule } from './rate-limit.js';

type Target = { name: string };

/** Reflector o'rnini bosuvchi: qoida handler nomiga qarab. */
function guard(rules: Record<string, RateLimitRule>, skip = false) {
  const reflector = {
    getAllAndOverride: (key: string, targets: Target[]) =>
      key === 'skipRateLimit' ? skip : rules[targets[0].name],
  };
  return new RateLimitGuard(reflector as never);
}

function ctx(req: object, handler = 'list') {
  return {
    getHandler: () => ({ name: handler }),
    getClass: () => ({ name: 'TestController' }),
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
};

describe('RateLimitGuard', () => {
  it("chegaradan oshganda 429; boshqa foydalanuvchiga ta'sir qilmaydi", () => {
    const g = guard({ create: { limit: 2, windowSec: 60 } });
    const a = ctx({ auth: { userId: 'a' }, headers: {} }, 'create');
    const b = ctx({ auth: { userId: 'b' }, headers: {} }, 'create');
    expect(g.canActivate(a)).toBe(true);
    expect(g.canActivate(a)).toBe(true);
    expect(status(() => g.canActivate(a))).toBe(429);
    expect(g.canActivate(b)).toBe(true);
  });

  it("maxsus qoidali marshrut umumiy hisobdan alohida", () => {
    const g = guard({ create: { limit: 1, windowSec: 60 } });
    const user = { auth: { userId: 'a' }, headers: {} };
    expect(g.canActivate(ctx(user, 'create'))).toBe(true);
    expect(status(() => g.canActivate(ctx(user, 'create')))).toBe(429);
    // Umumiy (120/daqiqa) hisob to'lmagan — oddiy marshrut ochiq.
    expect(g.canActivate(ctx(user, 'list'))).toBe(true);
  });

  it("BFF orqali kimligi noma'lum so'rov cheklanmaydi; IP uzatilsa — IP bo'yicha", () => {
    const g = guard({ login: { limit: 1, windowSec: 60 } });
    const anon = ctx({ viaProxy: true, headers: {} }, 'login');
    expect(g.canActivate(anon)).toBe(true);
    expect(g.canActivate(anon)).toBe(true);
    const ip = ctx(
      { viaProxy: true, headers: { 'x-real-client-ip': '1.2.3.4' } },
      'login',
    );
    expect(g.canActivate(ip)).toBe(true);
    expect(status(() => g.canActivate(ip))).toBe(429);
  });

  it("to'g'ridan-to'g'ri so'rov (BFF'siz) — req.ip bo'yicha", () => {
    const g = guard({ hook: { limit: 1, windowSec: 60 } });
    const direct = ctx({ ip: '9.9.9.9', headers: {} }, 'hook');
    expect(g.canActivate(direct)).toBe(true);
    expect(status(() => g.canActivate(direct))).toBe(429);
  });

  it('@SkipRateLimit — hech qachon cheklanmaydi', () => {
    const g = guard({ hook: { limit: 1, windowSec: 60 } }, true);
    const c = ctx({ auth: { userId: 'a' }, headers: {} }, 'hook');
    expect(g.canActivate(c)).toBe(true);
    expect(g.canActivate(c)).toBe(true);
  });
});
