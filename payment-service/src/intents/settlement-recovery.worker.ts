import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { IntentsService } from './intents.service';

@Injectable()
export class SettlementRecoveryWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementRecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(private readonly intents: IntentsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const intervalMs = Math.max(2_000, Number(process.env.PAYMENT_SETTLEMENT_RECOVERY_INTERVAL_MS ?? 15_000));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const completed = await this.intents.retryPendingSettlements(50);
      if (completed > 0) this.logger.log(`settled ${completed} recovered payment intent(s)`);
    } catch (error) {
      this.logger.warn(`settlement recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
