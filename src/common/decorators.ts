import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { AuthContext } from './auth-context.js';

/** `@Public()` — JWT tekshiruvini o'tkazib yuboradi (login, health). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * `@AllowDirect()` — BFF'siz, to'g'ridan-to'g'ri chaqiriladigan endpoint
 * (health-check, keyinchalik Payme/Click webhook'lari): `x-internal-secret`
 * talab qilinmaydi. Bunday endpoint o'z himoyasini o'zi ta'minlashi kerak
 * (masalan, provayder imzosini tekshirish).
 */
export const ALLOW_DIRECT_KEY = 'allowDirect';
export const AllowDirect = () => SetMetadata(ALLOW_DIRECT_KEY, true);

/** `@AdminOnly()` — faqat ADMIN roli (rol har so'rovda bazadan olinadi). */
export const ADMIN_ONLY_KEY = 'adminOnly';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

/** `@Auth() ctx: AuthContext` — guard biriktirgan joriy foydalanuvchi. */
export const Auth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext =>
    ctx.switchToHttp().getRequest<{ auth: AuthContext }>().auth,
);
