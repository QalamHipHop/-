import { Module } from '@nestjs/common';
import { AppConfig, loadConfig } from '../config/app.config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

export const APP_CONFIG = 'APP_CONFIG';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
  ],
  exports: [NotificationsService, APP_CONFIG],
})
export class NotificationsModule {}
