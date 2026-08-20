/**
 *  EventBus — thin NATS JetStream wrapper with in-process fan-out fallback.
 *  Subscribers are stored locally so any module can react to events even
 *  when NATS is not reachable (dev/single-node).
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { consumerOpts, JetStreamClient, JetStreamSubscription, StringCodec } from 'nats';
import { NatsConfig } from '../../config/nats.config';
import { NATS_JETSTREAM } from '../../infrastructure/nats/nats.module';

type Handler = (payload: unknown, raw: unknown) => void | Promise<void>;

@Injectable()
export class EventBusService implements OnModuleInit {
  private readonly logger = new Logger(EventBusService.name);
  private readonly sc = StringCodec();
  private readonly localSubs = new Map<string, Set<Handler>>();
  private readonly remoteSubs = new Map<string, JetStreamSubscription>();
  private jsAvailable = true;
  private readonly production = process.env.NODE_ENV === 'production';

  constructor(
    @Inject(NATS_JETSTREAM) private readonly js: JetStreamClient | null,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.js) {
      this.jsAvailable = false;
      if (this.production) throw new Error('NATS JetStream is required in production');
      return;
    }
    // Subscriptions are lazy on first .subscribe().
  }

  async publish(subject: string, payload: unknown, opts: { msgId?: string } = {}): Promise<void> {
    const body = this.sc.encode(JSON.stringify({ ts: new Date().toISOString(), payload }));
    if (!this.jsAvailable || !this.js) {
      if (this.production) throw new Error('NATS JetStream unavailable in production');
      this.fanoutLocal(subject, payload);
      return;
    }
    try {
      await this.js.publish(subject, body, { msgID: opts.msgId });
      if (!this.production) this.fanoutLocal(subject, payload);
    } catch (e) {
      if (this.production) throw e;
      this.logger.warn(`nats publish failed on ${subject}; using local development fanout: ${(e as Error).message}`);
      this.fanoutLocal(subject, payload);
    }
  }

  async publishDurable(subject: string, payload: unknown, msgId: string): Promise<void> {
    if (!this.jsAvailable || !this.js) throw new Error('NATS JetStream unavailable');
    const body = this.sc.encode(JSON.stringify({ ts: new Date().toISOString(), payload }));
    await this.js.publish(subject, body, { msgID: msgId });
    if (!this.production) this.fanoutLocal(subject, payload);
  }

  async subscribe(subject: string, handler: Handler): Promise<() => void> {
    if (!this.production) {
      if (!this.localSubs.has(subject)) this.localSubs.set(subject, new Set());
      this.localSubs.get(subject)!.add(handler);
    }
    if (this.jsAvailable && this.js && !this.remoteSubs.has(subject)) {
      try {
        const nats = this.config.get<NatsConfig>('nats');
        const durable = `${nats?.consumerPrefix ?? 'rial-backend'}-${subject.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`;
        const opts = consumerOpts()
          .bindStream(nats?.stream ?? 'rial-events')
          .durable(durable)
          .ackExplicit()
          .manualAck()
          .deliverAll()
          .ackWait(30_000)
          .maxDeliver(-1);
        const sub = await this.js.subscribe(subject, opts);
        this.remoteSubs.set(subject, sub);
        (async () => {
          for await (const msg of sub) {
            try {
              const data = JSON.parse(this.sc.decode(msg.data));
              this.fanoutLocal(subject, data.payload ?? data, data);
              msg.ack();
            } catch (e) {
              this.logger.warn(`subscriber ${subject} failed: ${(e as Error).message}`);
            }
          }
        })().catch((e) => this.logger.error(`sub loop ${subject}: ${(e as Error).message}`));
      } catch (e) {
        if (this.production) throw e;
        this.logger.warn(`nats subscribe failed for ${subject}: ${(e as Error).message}`);
      }
    } else if (this.production) {
      throw new Error(`NATS JetStream unavailable while subscribing to ${subject}`);
    }
    if (this.production) {
      if (!this.localSubs.has(subject)) this.localSubs.set(subject, new Set());
      this.localSubs.get(subject)!.add(handler);
    }
    return () => {
      this.localSubs.get(subject)?.delete(handler);
    };
  }

  private fanoutLocal(subject: string, payload: unknown, raw?: unknown) {
    for (const [s, handlers] of this.localSubs) {
      if (s === subject || s === '*' || matchGlob(s, subject)) {
        for (const h of handlers) {
          try { void h(payload, raw ?? payload); } catch (e) { this.logger.warn(`local handler error: ${(e as Error).message}`); }
        }
      }
    }
  }
}

function matchGlob(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  if (pattern === '>') return true;
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+').replace(/>/g, '.*') + '$');
  return regex.test(subject);
}
