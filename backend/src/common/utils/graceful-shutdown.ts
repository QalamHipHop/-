import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 *  Listens for SIGTERM/SIGINT — drains in-flight requests, then closes app.
 */
export function setupGracefulShutdown(app: INestApplicationContext): void {
  const logger = new Logger('Shutdown');
  const config = app.get(ConfigService);
  const timeout = config.get<number>('app.shutdownTimeoutMs', 15_000);

  const handle = async (signal: NodeJS.Signals): Promise<void> => {
    logger.log(`Received ${signal}, draining (timeout=${timeout}ms)…`);
    const force = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, timeout).unref();

    try {
      // @ts-expect-error: app may or may not have close()
      await app.close?.();
      clearTimeout(force);
      logger.log('Clean shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', err as Error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void handle('SIGTERM'));
  process.on('SIGINT', () => void handle('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('UnhandledRejection', reason as Error));
  process.on('uncaughtException', (err) => logger.error('UncaughtException', err));
}
