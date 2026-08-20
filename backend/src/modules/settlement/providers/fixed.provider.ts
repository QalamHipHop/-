import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateProvider } from './rate-provider.interface';
import { SettlementConfig } from '../../../config/settlement.config';

@Injectable()
export class FixedRateProvider implements RateProvider {
  readonly name = 'fixed';
  private readonly logger = new Logger(FixedRateProvider.name);
  constructor(private readonly config: ConfigService) {}

  async quote(): Promise<string | null> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    if (cfg.rateStrategy !== 'fixed') return null;
    const value = cfg.rateFixed?.trim() ?? '';
    return /^\d+(\.\d+)?$/.test(value) && value !== '0' ? value : null;
  }

  async healthy(): Promise<boolean> {
    return (await this.quote()) !== null;
  }
}
