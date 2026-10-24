import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * @Osontarget_bot nomidan xabar yuborish. Bot foydalanuvchiga faqat u ruxsat
 * bergan bo'lsa yoza oladi — Login Widget `request_access=write` bilan so'raydi.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Bot API metodini chaqiradi; xato bo'lsa `null` (log bilan). Faqat o'qish
   * va yuborish metodlari uchun — token URL'da, shuning uchun xato matni
   * URL'siz yoziladi.
   */
  async api<T>(method: string, params: object): Promise<T | null> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as {
        ok: boolean;
        result?: T;
        description?: string;
      };
      if (!body.ok) {
        this.logger.warn(`${method}: ${body.description ?? res.status}`);
        return null;
      }
      return body.result ?? null;
    } catch (e) {
      this.logger.warn(`${method}: ${e instanceof Error ? e.message : 'xato'}`);
      return null;
    }
  }

  /** `getFile` qaytargan `file_path` bo'yicha faylni yuklaydi (1 MB gacha). */
  async downloadFile(
    filePath: string,
    maxBytes = 1_048_576,
  ): Promise<{ body: Buffer; type: string } | null> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    try {
      const res = await fetch(
        `https://api.telegram.org/file/bot${token}/${filePath}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) return null;
      const ext = filePath.split('.').pop()?.toLowerCase();
      const type =
        ext === 'webp'
          ? 'image/webp'
          : ext === 'png'
            ? 'image/png'
            : ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : (res.headers.get('content-type') ?? 'application/octet-stream');
      return { body: buf, type };
    } catch (e) {
      this.logger.warn(`downloadFile: ${e instanceof Error ? e.message : 'xato'}`);
      return null;
    }
  }

  /** Yiqilsa faqat log yoziladi: bildirishnoma asosiy ishni to'xtatmasin. */
  async sendMessage(chatId: bigint | string, text: string): Promise<boolean> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.toString(),
            text,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = (await res.json()) as { ok: boolean; description?: string };
      if (!body.ok) {
        this.logger.warn(`sendMessage(${chatId}): ${body.description}`);
      }
      return body.ok;
    } catch (e) {
      // URL'da token bor — xatoning faqat matnini yozamiz.
      this.logger.warn(
        `sendMessage(${chatId}): ${e instanceof Error ? e.message : 'xato'}`,
      );
      return false;
    }
  }
}
