import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateProvider } from './rate-provider.interface';
import { SettlementConfig } from '../../../config/settlement.config';

@Injectable()
export class FixedRateProvider implements RateProvider {
  readonly name = 'fixed';
  private readonly logger = new Logger(FixedRateProvider.name);
  constructor(private readonly config: ConfigService) {}

  async quote(): Promise<number | null> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    if (cfg.rateStrategy !== 'fixed') return null;
    return cfg.rateFixed;
  }

  async healthy(): Promise<boolean> {
    return (await this.quote()) !== null;
  }
}
