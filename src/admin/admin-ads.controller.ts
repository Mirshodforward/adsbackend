import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { AdminOnly } from '../common/decorators.js';
import { AdminAdsService } from './admin-ads.service.js';

@AdminOnly()
@Controller('admin/ads')
export class AdminAdsController {
  constructor(private readonly ads: AdminAdsService) {}

  /** Barcha e'lonlar + egasi + so'mdagi pul + oxirgi 24 soat. */
  @Get()
  list() {
    return this.ads.list();
  }

  @Post('sync')
  @HttpCode(200)
  sync() {
    return this.ads.syncNow();
  }

  @Post(':adId/pause')
  @HttpCode(200)
  pause(@Param('adId', ParseIntPipe) adId: number) {
    return this.ads.setPaused(adId, true);
  }

  @Post(':adId/resume')
  @HttpCode(200)
  resume(@Param('adId', ParseIntPipe) adId: number) {
    return this.ads.setPaused(adId, false);
  }

  @Post(':adId/close')
  @HttpCode(200)
  close(@Param('adId', ParseIntPipe) adId: number) {
    return this.ads.close(adId);
  }
}
