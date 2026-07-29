'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TickerItem {
  symbol: string;
  price: number;
  change: number;
}

const SAMPLE: TickerItem[] = [
  { symbol: 'RIALS', price: 0.4234, change: 12.4 },
  { symbol: 'GALAXY', price: 0.0089, change: -3.2 },
  { symbol: 'MOON', price: 0.1245, change: 28.9 },
  { symbol: 'NEON', price: 1.872, change: 5.6 },
  { symbol: 'PEPE2', price: 0.00002, change: -12.1 },
  { symbol: 'SOLR', price: 12.34, change: 8.1 },
  { symbol: 'QALAM', price: 0.998, change: 0.4 },
  { symbol: 'BOLT', price: 0.0567, change: 15.7 },
];

export function TokenTicker() {
  const [items, setItems] = useState(SAMPLE);

  useEffect(() => {
    const id = setInterval(() => {
      setItems((prev) =>
        prev.map((it) => {
          const drift = (Math.random() - 0.5) * 0.01 * it.price;
          return { ...it, price: Math.max(0.000001, it.price + drift), change: it.change + (Math.random() - 0.5) * 0.4 };
        })
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const looped = [...items, ...items];

  return (
    <div className="border-y border-border/40 bg-muted/20 overflow-hidden">
      <div className="container">
        <div className="flex items-center gap-6 py-2 overflow-x-auto scrollbar-none">
          {looped.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm shrink-0">
              <span className="font-medium">{it.symbol}</span>
              <span className="font-mono text-muted-foreground">${it.price < 0.01 ? it.price.toFixed(6) : it.price.toFixed(4)}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-medium',
                  it.change >= 0 ? 'text-success' : 'text-destructive'
                )}
              >
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
