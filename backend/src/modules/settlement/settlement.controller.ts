import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/guards/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@Controller({ path: 'settlement', version: '1' })
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Public()
  @Get('info')
  async info() {
    return {
      symbol: this.svc.symbol,
      name: this.svc.name,
      decimals: this.svc.decimals,
    };
  }

  @Public()
  @Get('rate')
  async rate() {
    return this.svc.currentRate();
  }
}
