import { Module } from '@nestjs/common';
import { IntentsService } from './intents.service';
import { IntentStore } from './intent.store';
import { PaymentDatabase } from './payment-database.service';
import { WalletSettlementClient } from '../settlement/wallet-settlement.client';
import { SettlementRecoveryWorker } from './settlement-recovery.worker';

@Module({
  providers: [PaymentDatabase, IntentsService, IntentStore, WalletSettlementClient, SettlementRecoveryWorker],
  exports: [IntentsService, IntentStore, PaymentDatabase],
})
export class IntentsModule {}
