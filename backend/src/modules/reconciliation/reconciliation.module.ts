import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationWorker } from './reconciliation.worker';

@Module({
  imports: [DatabaseModule],
  providers: [ReconciliationService, ReconciliationWorker],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
