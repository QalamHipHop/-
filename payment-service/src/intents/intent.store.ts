// =============================================================================
//  IntentStore — in-memory store with idempotency-key dedup, swappable for PG
//  Author: QalamCode
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PaymentIntent, IntentKind, IntentStatus } from './intent.entity';

export interface ListFilter {
  userId?: string;
  kind?: IntentKind;
  status?: IntentStatus;
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: PaymentIntent[];
  total: number;
}

@Injectable()
export class IntentStore {
  private readonly log = new Logger(IntentStore.name);
  private readonly byId = new Map<string, PaymentIntent>();
  private readonly byIdemKey = new Map<string, string>(); // key -> intent id
  private readonly byUser = new Map<string, Set<string>>(); // userId -> intent ids

  save(intent: PaymentIntent): PaymentIntent {
    this.byId.set(intent.id, intent);
    this.byIdemKey.set(this.idemKey(intent.userId, intent.idempotencyKey), intent.id);
    let set = this.byUser.get(intent.userId);
    if (!set) {
      set = new Set();
      this.byUser.set(intent.userId, set);
    }
    set.add(intent.id);
    return intent;
  }

  get(id: string): PaymentIntent | undefined {
    return this.byId.get(id);
  }

  findByIdempotency(userId: string, key: string): PaymentIntent | undefined {
    const id = this.byIdemKey.get(this.idemKey(userId, key));
    return id ? this.byId.get(id) : undefined;
  }

  list(f: ListFilter): ListResult {
    const all: PaymentIntent[] = [];
    for (const set of this.byUser.values()) {
      for (const id of set) {
        const it = this.byId.get(id);
        if (!it) continue;
        if (f.userId && it.userId !== f.userId) continue;
        if (f.kind && it.kind !== f.kind) continue;
        if (f.status && it.status !== f.status) continue;
        all.push(it);
      }
    }
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = all.length;
    const start = (f.page - 1) * f.pageSize;
    const items = all.slice(start, start + f.pageSize);
    return { items, total };
  }

  private idemKey(userId: string, key: string): string {
    return `${userId}::${key}`;
  }
}
