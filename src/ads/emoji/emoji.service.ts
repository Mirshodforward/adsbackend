import { Injectable, Logger } from '@nestjs/common';
import { TelegramBotService } from '../../telegram-bot/telegram-bot.service.js';
import { EMOJI_CATALOG } from './catalog.js';

interface Sticker {
  file_id: string;
  is_animated?: boolean;
  is_video?: boolean;
  thumbnail?: { file_id: string };
  emoji?: string;
}

type Cached =
  | { kind: 'hit'; body: Buffer; type: string; at: number }
  | { kind: 'miss'; at: number };

const HIT_TTL_MS = 7 * 24 * 3600_000;
const MISS_TTL_MS = 3600_000;
const MAX_ENTRIES = 1000;

/**
 * Premium emoji: kabinet uchun katalog va rasmli ko'rinish (statik eskiz).
 * Eskiz Bot API orqali olinadi (getCustomEmojiStickers → getFile) va xotirada
 * keshlanadi — bir emoji uchun Telegram'ga ko'pi bilan haftada bir so'rov.
 */
@Injectable()
export class EmojiService {
  private readonly logger = new Logger(EmojiService.name);
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly bot: TelegramBotService) {}

  list() {
    return {
      items: EMOJI_CATALOG.map(({ ch, id, animated, category }) => ({
        ch,
        id,
        animated,
        category,
      })),
    };
  }

  /** Statik eskiz (webp/jpg). Topilmasa yoki Telegram bermasa — `null`. */
  async thumbnail(id: string): Promise<{ body: Buffer; type: string } | null> {
    const cached = this.cache.get(id);
    if (cached) {
      const ttl = cached.kind === 'hit' ? HIT_TTL_MS : MISS_TTL_MS;
      if (Date.now() - cached.at < ttl) {
        return cached.kind === 'hit' ? { body: cached.body, type: cached.type } : null;
      }
      this.cache.delete(id);
    }
    const result = await this.fetchThumbnail(id);
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(
      id,
      result
        ? { kind: 'hit', body: result.body, type: result.type, at: Date.now() }
        : { kind: 'miss', at: Date.now() },
    );
    return result;
  }

  private async fetchThumbnail(id: string) {
    const stickers = await this.bot.api<Sticker[]>('getCustomEmojiStickers', {
      custom_emoji_ids: [id],
    });
    const sticker = stickers?.[0];
    if (!sticker) return null;
    // Animatsion (tgs) va video (webm) emojini brauzer ko'rsata olmaydi — eskizini olamiz.
    const fileId =
      sticker.thumbnail?.file_id ??
      (sticker.is_animated || sticker.is_video ? undefined : sticker.file_id);
    if (!fileId) return null;
    const file = await this.bot.api<{ file_path?: string }>('getFile', {
      file_id: fileId,
    });
    if (!file?.file_path) return null;
    const downloaded = await this.bot.downloadFile(file.file_path);
    if (!downloaded) this.logger.warn(`emoji ${id}: eskiz yuklanmadi`);
    return downloaded;
  }
}
