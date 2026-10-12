import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { ProxiedRequest } from '../client-meta.js';
import { ALLOW_DIRECT_KEY } from '../decorators.js';
import { fail } from '../http.js';

// Xesh — ikkala tomon bir xil uzunlikda bo'lsin (timingSafeEqual sharti).
const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Backend internetga ochiq (api.osontarget.uz), lekin uni faqat Vercel'dagi
 * BFF chaqirishi kerak: har so'rovda `x-internal-secret` mos kelishi shart.
 * Sir sozlanmagan bo'lsa (lokal ishlash) tekshirmaymiz — productionda env
 * validatsiyasi uni majburiy qiladi.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly secret?: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    const secret = config.get('INTERNAL_API_SECRET', { infer: true });
    this.secret = secret ? digest(secret) : undefined;
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.secret) return true;

    const allowDirect = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DIRECT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allowDirect) return true;

    const req = ctx.switchToHttp().getRequest<Request & ProxiedRequest>();
    const provided = req.headers['x-internal-secret'];
    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), this.secret)
    ) {
      fail("Ruxsat yo'q", 403);
    }

    // So'rov ishonchli BFF'dan keldi — faqat shunda u uzatgan mijoz IP'si va
    // brauzeriga ishonamiz (qarang: client-meta.ts).
    req.viaProxy = true;
    return true;
  }
}
