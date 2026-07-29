// =============================================================================
//  Shared adapter types
//  Author: QalamCode
// =============================================================================
export type PaymentKind = 'deposit' | 'withdrawal';

export interface Money {
  amountMinor: bigint;
  currency: string;
}

export interface MoneyJSON {
  amountMinor: string;
  currency: string;
}

export function toJSON(m: Money): MoneyJSON {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

export function fromJSON(m: MoneyJSON): Money {
  return { amountMinor: BigInt(m.amountMinor), currency: m.currency };
}

export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retriable: boolean = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}
