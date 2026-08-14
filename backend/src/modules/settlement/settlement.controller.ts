import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';

import { Public } from '../../common/guards/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@Controller('settlement')
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Public()
  @Get('info')
  async info() {
    return {
      symbol: this.svc.symbol,
      name: this.svc.name,
      decimals: this.svc.decimals,
      minCredit: this.svc.minCredit.toString(),
      maxCredit: this.svc.maxCredit.toString(),
      reserveAccount: this.svc.reserveAccount,
      treasuryAccount: this.svc.treasuryAccount,
    };
  }

  @Public()
  @Get('rate')
  async rate() {
    return this.svc.currentRate();
  }

  @Public()
  @Get('providers')
  async providers() {
    return { items: this.svc.listProviders() };
  }

  @Public()
  @Post('convert')
  async convert(@Body() body: { usd?: number; rialMinor?: string; rialMajor?: string }) {
    if (typeof body.usd === 'number' && Number.isFinite(body.usd)) {
      const minor = await this.svc.convertUsdToRial(body.usd);
      return {
        input: { usd: body.usd },
        output: { rialMinor: minor.toString(), rialMajor: this.svc.fromMinor(minor) },
      };
    }
    if (body.rialMinor) {
      const minor = BigInt(body.rialMinor);
      return {
        input: { rialMinor: body.rialMinor },
        output: { usd: await this.svc.convertRialToUsd(minor) },
      };
    }
    if (body.rialMajor) {
      const minor = this.svc.toMinor(body.rialMajor);
      return {
        input: { rialMajor: body.rialMajor },
        output: { rialMinor: minor.toString(), usd: await this.svc.convertRialToUsd(minor) },
      };
    }
    throw new BadRequestException({ code: 'CONVERT_INPUT_MISSING', message: 'one of usd, rialMinor, rialMajor required' });
  }
}
