import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`notification-service listening on :${cfg.port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed', err);
  process.exit(1);
});
