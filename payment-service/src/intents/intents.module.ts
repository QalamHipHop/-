import { Module } from '@nestjs/common';
import { IntentsService } from './intents.service';
import { IntentStore } from './intent.store';

@Module({
  providers: [IntentsService, IntentStore],
  exports: [IntentsService, IntentStore],
})
export class IntentsModule {}
