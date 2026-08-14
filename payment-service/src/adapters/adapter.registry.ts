// =============================================================================
//  AdapterRegistry — central place to resolve the right adapter for a name
//  Author: Qalamhiphop
// =============================================================================
import { Injectable } from '@nestjs/common';
import { ManualAdapter } from './manual.adapter';
import { StripeAdapter } from './stripe.adapter';
import { ZarinPalAdapter } from './zarinpal.adapter';
import { NowPaymentsAdapter } from './nowpayments.adapter';
import { PaymentAdapter } from './adapter.interface';
import { PaymentError } from './types';

export type AdapterName = 'manual' | 'stripe' | 'zarinpal' | 'nowpayments';

@Injectable()
export class AdapterRegistry {
  constructor(
    private readonly manual: ManualAdapter,
    private readonly stripe: StripeAdapter,
    private readonly zarinpal: ZarinPalAdapter,
    private readonly nowpayments: NowPaymentsAdapter,
  ) {}

  get(name: string): PaymentAdapter {
    switch (name) {
      case 'manual':
        return this.manual;
      case 'stripe':
        return this.stripe;
      case 'zarinpal':
        return this.zarinpal;
      case 'nowpayments':
        return this.nowpayments;
      default:
        throw new PaymentError('UNKNOWN_ADAPTER', 'no such adapter: ' + name, false);
    }
  }

  list(): { name: AdapterName; enabled: boolean; sandbox: boolean }[] {
    return [
      { name: 'manual', enabled: true, sandbox: false },
      { name: 'stripe', enabled: this.stripe.isEnabled, sandbox: this.stripe.info.sandbox },
      { name: 'zarinpal', enabled: this.zarinpal.isEnabled, sandbox: this.zarinpal.info.sandbox },
      { name: 'nowpayments', enabled: this.nowpayments.isEnabled, sandbox: this.nowpayments.info.sandbox },
    ];
  }
}
