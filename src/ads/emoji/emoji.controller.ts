import {
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { fail } from '../../common/http.js';
import { RateLimit } from '../../common/rate-limit.js';
import { EmojiService } from './emoji.service.js';

/** Premium emoji katalogi va eskizlari — kabinet tahrirlagichi uchun. */
@RateLimit(600)
@Controller('ads/emoji')
export class EmojiController {
  constructor(private readonly emoji: EmojiService) {}

  @Get()
  list() {
    return this.emoji.list();
  }

  /** Statik eskiz; brauzer va BFF bir hafta keshlaydi. */
  @Get(':id/thumb')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async thumb(@Param('id') id: string) {
    if (!/^\d{5,40}$/.test(id)) fail('Topilmadi', 404);
    const t = await this.emoji.thumbnail(id);
    if (!t) fail('Topilmadi', 404);
    return new StreamableFile(t.body, { type: t.type });
  }
}
