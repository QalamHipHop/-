import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../infrastructure/database/db.service';
import { EventBusService } from './event-bus.service';

type OutboxRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

@Injectable()
export class OutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(private readonly db: DbService, private readonly bus: EventBusService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 1_000);
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
      const rows = await this.claim(100);
      for (const row of rows) {
        try {
          await this.bus.publishDurable(row.event_type, row.payload, row.id);
          await this.db.query(
            `UPDATE shared.outbox SET published_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`,
            [row.id],
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.fail(row.id, row.attempts + 1, message);
          this.logger.warn(`outbox publish failed id=${row.id}: ${message}`);
        }
      }
    } catch (error) {
      this.logger.warn(`outbox tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async claim(limit: number): Promise<OutboxRow[]> {
    return this.db.withTransaction(async (tx) => {
      const result = await tx.query<OutboxRow>(
        `WITH picked AS (
           SELECT id FROM shared.outbox
           WHERE source_service = 'backend'
             AND published_at IS NULL
             AND (next_attempt_at IS NULL OR next_attempt_at <= now())
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE shared.outbox o
            SET locked_until = now() + interval '30 seconds'
           FROM picked
          WHERE o.id = picked.id
         RETURNING o.id, o.event_type, o.payload, o.attempts`,
        [limit],
      );
      return result.rows;
    });
  }

  private async fail(id: string, attempts: number, error: string): Promise<void> {
    const delaySeconds = Math.min(300, Math.max(1, 2 ** Math.min(attempts, 8)));
    await this.db.query(
      `UPDATE shared.outbox
          SET attempts = $2,
              last_error = left($3, 2000),
              next_attempt_at = now() + ($4 * interval '1 second'),
              locked_until = NULL
        WHERE id = $1 AND published_at IS NULL`,
      [id, attempts, error, delaySeconds],
    );
  }
}
