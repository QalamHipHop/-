import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Analytics listening on :${cfg.port}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Analytics bootstrap failed:', e);
  process.exit(1);
});
