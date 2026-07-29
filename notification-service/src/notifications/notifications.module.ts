import { Module } from '@nestjs/common';
import { AppConfig, loadConfig } from '../config/app.config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: AppConfig, useFactory: () => loadConfig() },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
