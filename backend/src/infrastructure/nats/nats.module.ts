/**
 *  NATS JetStream module — internal event bus. Producers, consumers, and a simple service handle.
 */
import { Global, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { connect, NatsConnection, JetStreamClient, JetStreamManager } from 'nats';

import { NatsConfig } from '../../config/nats.config';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const NATS_JETSTREAM = 'NATS_JETSTREAM';
export const NATS_MANAGER = 'NATS_MANAGER';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: NATS_CONNECTION,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<NatsConnection> => {
        const cfg = config.get<NatsConfig>('nats')!;
        return connect({
          servers: cfg.servers,
          token: cfg.token ?? undefined,
          user: cfg.user ?? undefined,
          pass: cfg.pass ?? undefined,
          name: 'rial-backend',
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 2_000,
        });
      },
    },
    {
      provide: NATS_JETSTREAM,
      inject: [NATS_CONNECTION],
      useFactory: (nc: NatsConnection): JetStreamClient => nc.jetstream(),
    },
    {
      provide: NATS_MANAGER,
      inject: [NATS_CONNECTION],
      useFactory: (nc: NatsConnection): JetStreamManager => nc.jetstreamManager(),
    },
  ],
  exports: [NATS_CONNECTION, NATS_JETSTREAM, NATS_MANAGER],
})
export class NatsModule implements OnApplicationShutdown {
  private readonly logger = new Logger(NatsModule.name);
  async onApplicationShutdown(): Promise<void> {
    // Module-level hook; the connection itself is closed by providers that own it.
    this.logger.log('NATS module teardown complete');
  }
}
