import type { Request } from 'express';

/** `InternalSecretGuard` sir mos kelganda `viaProxy = true` qo'yadi. */
export interface ProxiedRequest {
  viaProxy?: boolean;
}

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Mijozning IP'si va brauzeri — faqat ishonchli BFF orqali kelgan so'rovda.
 *
 * Prodda `req.ip` Caddy ko'rgan manzil, ya'ni Vercel serveri — mijoz emas.
 * Haqiqiy qiymatlarni BFF `x-real-client-ip` / `x-real-user-agent` da
 * uzatadi, lekin bu header'larni istalgan odam soxtalashtira oladi. Shuning
 * uchun sirsiz so'rovda hech narsa qaytarmaymiz: sessiyadagi yolg'on IP umuman
 * IP yo'qligidan yomonroq — u yolg'on dalil beradi.
 */
export function clientMeta(req: Request & ProxiedRequest): ClientMeta {
  if (!req.viaProxy) return {};

  const header = (name: string) => {
    const value = req.headers[name];
    return typeof value === 'string' && value ? value : undefined;
  };
  return {
    ip: header('x-real-client-ip')?.slice(0, 64),
    userAgent: header('x-real-user-agent')?.slice(0, 512),
  };
}
