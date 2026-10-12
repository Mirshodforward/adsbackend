import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { JwtPayload } from '../common/auth-context.js';
import type { ClientMeta } from '../common/client-meta.js';
import { fail } from '../common/http.js';
import type { Env } from '../config/env.js';
import type { Role, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyTelegramLogin } from './telegram-login.js';

/**
 * Almashtirilgan refresh token yana shuncha vaqt qabul qilinadi. Sahifa
 * ochilganda bir nechta parallel so'rov bir xil eski token bilan keladi —
 * ulardan faqat birinchisi rotatsiya qiladi, qolganlari shu oynaga sig'adi.
 */
const ROTATION_GRACE_MS = 60_000;

export interface PublicUser {
  id: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  role: Role;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  accessExpiresIn: number; // soniya
  refreshToken: string;
  refreshExpiresIn: number; // soniya
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    telegramId: u.telegramId.toString(), // BigInt JSON'ga sig'maydi
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    photoUrl: u.photoUrl,
    role: u.role,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async loginWithTelegram(
    data: Record<string, unknown>,
    meta: ClientMeta,
  ): Promise<AuthResult> {
    const check = verifyTelegramLogin(
      data,
      this.config.get('TELEGRAM_BOT_TOKEN', { infer: true }),
      this.config.get('TELEGRAM_AUTH_MAX_AGE_SEC', { infer: true }),
    );
    if (!check.ok) {
      fail(
        check.reason === 'expired'
          ? "Telegram ma'lumoti eskirgan — qaytadan kiring"
          : 'Telegram imzosi tasdiqlanmadi',
        401,
      );
    }

    const tg = check.user;
    // Ism, username va rasm Telegram'da o'zgarishi mumkin — har kirishda yangilaymiz.
    const profile = {
      firstName: tg.firstName,
      lastName: tg.lastName,
      username: tg.username,
      photoUrl: tg.photoUrl,
      lastLoginAt: new Date(),
    };
    const user = await this.db.user.upsert({
      where: { telegramId: tg.id },
      create: { telegramId: tg.id, ...profile },
      update: profile,
    });
    if (!user.isActive) fail('Hisobingiz bloklangan', 403);

    return this.issue(user, randomUUID(), meta);
  }

  async refresh(refreshToken: string, meta: ClientMeta): Promise<AuthResult> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) {
      fail('Sessiya tugagan — qaytadan kiring', 401);
    }

    if (session.rotatedAt) {
      if (now - session.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        // Allaqachon almashtirilgan token grace'dan keyin qayta keldi — u
        // o'g'irlangan bo'lishi mumkin. Butun oilani yopamiz: haqiqiy egasi
        // ham, o'g'ri ham qaytadan kirishga majbur bo'ladi.
        await this.revokeFamily(session.familyId);
        fail('Sessiya tugagan — qaytadan kiring', 401);
      }
    } else {
      // Shartli update: parallel so'rovlardan faqat bittasi rotatsiyani belgilaydi.
      await this.db.session.updateMany({
        where: { id: session.id, rotatedAt: null },
        data: { rotatedAt: new Date(now) },
      });
    }

    if (!session.user.isActive) fail('Hisobingiz bloklangan', 401);
    return this.issue(session.user, session.familyId, meta);
  }

  async logout(refreshToken: string) {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: { familyId: true },
    });
    if (session) await this.revokeFamily(session.familyId);
    return { ok: true };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) fail('Foydalanuvchi topilmadi', 404);
    return toPublicUser(user);
  }

  private revokeFamily(familyId: string) {
    return this.db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    user: User,
    familyId: string,
    meta: ClientMeta,
  ): Promise<AuthResult> {
    const accessExpiresIn = this.config.get('JWT_ACCESS_TTL_SEC', {
      infer: true,
    });
    const refreshExpiresIn =
      this.config.get('REFRESH_TTL_DAYS', { infer: true }) * 86_400;
    const refreshToken = randomBytes(32).toString('base64url');

    await this.db.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      user: toPublicUser(user),
      accessToken: await this.jwt.signAsync(payload),
      accessExpiresIn,
      refreshToken,
      refreshExpiresIn,
    };
  }
}
