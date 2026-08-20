import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(private readonly reconciliation: ReconciliationService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const intervalMs = Math.max(60_000, Number(process.env.RECONCILIATION_INTERVAL_MS ?? 900_000));
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
      const result = await this.reconciliation.run('wallet', 'system:reconciliation-worker');
      if (result.status !== 'passed') {
        this.logger.error(`reconciliation found ${result.findings} discrepancy/discrepancies`, undefined, JSON.stringify(result));
      } else {
        this.logger.debug(`reconciliation passed for ${result.accountsChecked} accounts`);
      }
    } catch (error) {
      this.logger.error(`reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
