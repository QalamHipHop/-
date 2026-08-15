import { Module } from '@nestjs/common';
import { IntentsService } from './intents.service';
import { IntentStore } from './intent.store';
import { PaymentDatabase } from './payment-database.service';

@Module({
  providers: [PaymentDatabase, IntentsService, IntentStore],
  exports: [IntentsService, IntentStore],
})
export class IntentsModule {}
