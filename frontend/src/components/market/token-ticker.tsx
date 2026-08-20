// Author: QalamHipHop
'use client';

import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TickerItem {
  symbol: string;
  price: number;
  change: number;
}

export function TokenTicker({ items = [] }: { items?: TickerItem[] }) {
  if (items.length === 0) {
    return (
      <div className="border-y border-border/40 bg-muted/20">
        <div className="container py-2 text-center text-xs text-muted-foreground">
          Live market data is temporarily unavailable. No synthetic prices are shown.
        </div>
      </div>
    );
  }

  const looped = [...items, ...items];
  return (
    <div className="border-y border-border/40 bg-muted/20 overflow-hidden">
      <div className="container">
        <div className="flex items-center gap-6 py-2 overflow-x-auto scrollbar-none">
          {looped.map((it, idx) => (
            <div key={`${it.symbol}-${idx}`} className="flex items-center gap-2 text-sm shrink-0">
              <span className="font-medium">{it.symbol}</span>
              <span className="font-mono text-muted-foreground">{it.price < 0.01 ? it.price.toFixed(6) : it.price.toFixed(4)} ﷼</span>
              <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', it.change >= 0 ? 'text-success' : 'text-destructive')}>
                {it.change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(it.change).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
