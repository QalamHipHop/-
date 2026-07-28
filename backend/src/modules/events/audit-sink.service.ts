import { Inject, Injectable, Logger } from '@nestjs/common';
import { Producer } from 'kafkajs';
import { createHash } from 'crypto';

import { KAFKA_PRODUCER } from '../../infrastructure/kafka/kafka.module';
import { ConfigService } from '@nestjs/config';
import { KafkaConfig } from '../../config/kafka.config';

export interface AuditEvent {
  aggregate: string;
  aggregateId: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  prevHash?: Buffer;
}

@Injectable()
export class AuditSinkService {
  private readonly logger = new Logger(AuditSinkService.name);
  private lastHashByAgg = new Map<string, Buffer>();

  constructor(
    @Inject(KAFKA_PRODUCER) private readonly producer: Producer,
    private readonly config: ConfigService,
  ) {}

  async emit(ev: AuditEvent): Promise<void> {
    const topic = this.config.get<KafkaConfig>('kafka')!.auditTopic;
    const payloadJson = JSON.stringify({ ...ev.payload, actor: ev.actor, action: ev.action });
    const h = createHash('sha256').update(payloadJson).digest();
    const prev = ev.prevHash ?? this.lastHashByAgg.get(`${ev.aggregate}:${ev.aggregateId}` ?? '') ?? null;
    const linked = createHash('sha256').update(Buffer.concat([prev ?? Buffer.alloc(0), h])).digest();
    this.lastHashByAgg.set(`${ev.aggregate}:${ev.aggregateId}`, linked);

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: `${ev.aggregate}:${ev.aggregateId}`,
            value: JSON.stringify({
              aggregate: ev.aggregate,
              aggregate_id: ev.aggregateId,
              actor: ev.actor,
              action: ev.action,
              payload: ev.payload,
              payload_hash: h.toString('hex'),
              prev_hash: prev?.toString('hex') ?? null,
              hash: linked.toString('hex'),
              created_at: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (e) {
      this.logger.error(`audit emit failed: ${(e as Error).message}`);
      // do not block the calling flow — audit is best-effort here
    }
  }
}
