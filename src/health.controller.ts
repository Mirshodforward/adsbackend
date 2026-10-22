import { Controller, Get } from '@nestjs/common';
import { AllowDirect, Public } from './common/decorators.js';
import { SkipRateLimit } from './common/rate-limit.js';
import { PrismaService } from './prisma/prisma.service.js';

// Docker healthcheck va monitoring sirsiz chaqiradi.
@AllowDirect()
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async check() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
