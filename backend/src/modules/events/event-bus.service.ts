import { Inject, Injectable, Logger } from '@nestjs/common';
import { JetStreamClient, StringCodec } from 'nats';
import { NATS_JETSTREAM } from '../../infrastructure/nats/nats.module';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly sc = StringCodec();

  constructor(@Inject(NATS_JETSTREAM) private readonly js: JetStreamClient) {}

  async publish(subject: string, payload: unknown, opts: { msgId?: string } = {}): Promise<void> {
    const body = this.sc.encode(JSON.stringify({ ts: new Date().toISOString(), payload }));
    try {
      await this.js.publish(subject, body, { msgID: opts.msgId });
    } catch (e) {
      this.logger.error(`publish failed on ${subject}`, e as Error);
      throw e;
    }
  }
}
