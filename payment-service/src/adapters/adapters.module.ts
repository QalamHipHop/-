// =============================================================================
//  AdaptersModule — DI container for all payment adapters
//  Author: Qalamhiphop
// =============================================================================
import { Global, Module } from '@nestjs/common';
import { ManualAdapter } from './manual.adapter';
import { StripeAdapter } from './stripe.adapter';
import { ZarinPalAdapter } from './zarinpal.adapter';
import { NowPaymentsAdapter } from './nowpayments.adapter';
import { AdapterRegistry } from './adapter.registry';

@Global()
@Module({
  providers: [ManualAdapter, StripeAdapter, ZarinPalAdapter, NowPaymentsAdapter, AdapterRegistry],
  exports: [AdapterRegistry, ManualAdapter, StripeAdapter, ZarinPalAdapter, NowPaymentsAdapter],
})
export class AdaptersModule {}
