import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext } from './auth-context.js';
import type { ProxiedRequest } from './client-meta.js';
import { fail } from './http.js';

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

/** `@RateLimit(10, 60)` — bitta foydalanuvchi (yoki IP) uchun 60 soniyada 10 ta so'rov. */
export const RateLimit = (limit: number, windowSec = 60) =>
  SetMetadata<string, RateLimitRule>(RATE_LIMIT_KEY, { limit, windowSec });

/** Chegarasiz marshrut (provayder webhook'i, health). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/** Maxsus qoida yo'q marshrutlar uchun: foydalanuvchi/IP'ga daqiqasiga. */
export const DEFAULT_RULE: RateLimitRule = { limit: 120, windowSec: 60 };

const SWEEP_EVERY_MS = 60_000;
const KEEP_MS = 15 * 60_000;

/**
 * So'rov chegarasi — sodda sirpanuvchi oyna, xotirada (bitta pm2 jarayoni).
 *
 * Nega kerak: hamma mijoz amallari bitta umumiy Telegram Ads tokeni orqali
 * o'tadi. Bitta mijoz skript bilan ming marta "pauza" bossa, token
 * bloklanadi va butun xizmat to'xtaydi.
 *
 * Kalit — kirgan foydalanuvchi id'si; kirmagan bo'lsa BFF uzatgan mijoz IP'si
 * (`x-real-client-ip`, faqat ishonchli so'rovda); boshqa holda `req.ip`.
 * Maxsus qoidali marshrut o'z hisobini yuritadi, qolganlari umumiy hisobda.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets))
      return true;
    const rule =
      this.reflector.getAllAndOverride<RateLimitRule>(RATE_LIMIT_KEY, targets) ??
      DEFAULT_RULE;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & ProxiedRequest & { auth?: AuthContext }>();
    const forwarded = req.headers['x-real-client-ip'];
    const who =
      req.auth?.userId ??
      (req.viaProxy
        ? typeof forwarded === 'string' && forwarded
          ? forwarded
          : null
        : (req.ip ?? null));
    // BFF orqali kelgan, lekin kimligi noma'lum so'rov (IP uzatilmagan):
    // umumiy Vercel IP'sini cheklab, hamma foydalanuvchini to'sib qo'ymaymiz.
    if (!who) return true;
    const scope =
      rule === DEFAULT_RULE
        ? 'default'
        : `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const key = `${scope}:${who}`;

    const now = Date.now();
    const since = now - rule.windowSec * 1000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= rule.limit) {
      fail("Juda ko'p so'rov — birozdan so'ng urinib ko'ring", 429);
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.sweep(now);
    return true;
  }

  /** Testlar uchun: hisobni tozalash. */
  reset() {
    this.hits.clear();
  }

  private sweep(now: number) {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      const keep = times.filter((t) => t > now - KEEP_MS);
      if (keep.length) this.hits.set(key, keep);
      else this.hits.delete(key);
    }
  }
}
