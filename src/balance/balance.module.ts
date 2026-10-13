import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service.js';

@Module({
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
