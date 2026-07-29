import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
