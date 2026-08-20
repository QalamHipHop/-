import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TradingService } from './trading.service';

@Injectable()
export class TradeSettlementRecoveryWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TradeSettlementRecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  constructor(
    private readonly trading: TradingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Math.max(1_000, this.config.get<number>('trading.settlementRecoveryIntervalMs', 5_000));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const recovered = await this.trading.recoverPendingTradeSettlements(20);
      if (recovered > 0) this.logger.log(`recovered ${recovered} trade settlements`);
    } catch (error) {
      this.logger.warn(`trade settlement recovery failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
