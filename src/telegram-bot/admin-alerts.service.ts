import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { TelegramBotService } from './telegram-bot.service.js';

/** Bir xil kalitli ogohlantirish shu oraliqda takrorlanmaydi. */
const DEFAULT_EVERY_MS = 6 * 3600_000;

/**
 * Adminlarga (`ADMIN_TELEGRAM_IDS`) bot orqali ogohlantirish: TON kam, kurs
 * eskirgan, sinxronlash yiqildi, pul amali hal bo'lmadi va hokazo.
 *
 * `key` berilsa, o'sha holat haqida xabar `everyMs` ichida bir marta ketadi
 * (har 5 daqiqalik sinxronlash spam qilmasin); holat normallashganda
 * `clear(key)` chaqiriladi — keyingi muammo darhol xabar qilinadi.
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async send(
    text: string,
    opts: { key?: string; everyMs?: number } = {},
  ): Promise<boolean> {
    const { key, everyMs = DEFAULT_EVERY_MS } = opts;
    if (key) {
      const last = this.lastSent.get(key) ?? 0;
      if (Date.now() - last < everyMs) return false;
      this.lastSent.set(key, Date.now());
    }
    const ids = this.config.get('ADMIN_TELEGRAM_IDS', { infer: true });
    if (!ids.length) {
      this.logger.warn(`Admin ID yo'q — yuborilmadi: ${text.slice(0, 80)}`);
      return false;
    }
    let delivered = false;
    for (const id of ids) {
      if (await this.bot.sendMessage(id, text)) delivered = true;
    }
    return delivered;
  }

  /** Holat normallashdi — keyingi ogohlantirish kutmasdan chiqsin. */
  clear(key: string) {
    this.lastSent.delete(key);
  }
}
