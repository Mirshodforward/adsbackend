import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context.js';
import { clientMeta } from '../common/client-meta.js';
import { Auth, Public } from '../common/decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';

/**
 * Login Widget `onauth` callback'i qaytargan obyekt. Noma'lum maydonlar ham
 * saqlab qolinadi — ular ham imzoga kiradi (qarang: telegram-login.ts).
 */
const telegramSchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string().max(256).optional(),
    last_name: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    photo_url: z.string().max(2048).optional(),
    auth_date: z.number().int().positive(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .catchall(z.union([z.string().max(2048), z.number()]));

const refreshSchema = z.object({ refreshToken: z.string().min(1).max(256) });
/** Mini App: `window.Telegram.WebApp.initData` — xom query-string. */
const webAppSchema = z.object({ initData: z.string().min(1).max(8192) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Frontend BFF Telegram Login Widget ma'lumotini shu yerga uzatadi. */
  @Public()
  @Post('telegram')
  @HttpCode(200)
  telegram(
    @Body(zodBody(telegramSchema)) body: z.infer<typeof telegramSchema>,
    @Req() req: Request,
  ) {
    return this.auth.loginWithTelegram(body, clientMeta(req));
  }

  /** Telegram Mini App ichidan: initData imzosi bilan kirish (widget'siz). */
  @Public()
  @Post('telegram-webapp')
  @HttpCode(200)
  telegramWebApp(
    @Body(zodBody(webAppSchema)) body: z.infer<typeof webAppSchema>,
    @Req() req: Request,
  ) {
    return this.auth.loginWithWebApp(body.initData, clientMeta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(zodBody(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
  ) {
    return this.auth.refresh(body.refreshToken, clientMeta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(zodBody(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@Auth() ctx: AuthContext) {
    return this.auth.me(ctx.userId);
  }
}
