import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext, JwtPayload } from '../auth-context.js';
import { ADMIN_ONLY_KEY, IS_PUBLIC_KEY } from '../decorators.js';
import { fail } from '../http.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { auth?: AuthContext }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) fail('Tizimga kiring', 401);

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      fail('Tizimga kiring', 401);
    }

    // Tokendagi rolga ishonmaymiz: bloklangan yoki roli o'zgargan foydalanuvchi
    // access token muddati tugashini kutmasdan darhol ta'sirlansin.
    const user = await this.db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user?.isActive) fail('Hisobingiz faol emas', 401);

    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      ADMIN_ONLY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (adminOnly && user.role !== 'ADMIN') fail("Ruxsat yo'q", 403);

    req.auth = { userId: user.id, role: user.role };
    return true;
  }
}
