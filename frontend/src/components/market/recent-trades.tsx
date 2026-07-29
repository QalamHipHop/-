'use client';

import { useEffect, useState } from 'react';
import { getWsClient } from '@/lib/ws';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface Trade {
  id: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  ts: number;
}

interface RecentTradesProps {
  symbol: string;
  initial?: Trade[];
}

export function RecentTrades({ symbol, initial = [] }: RecentTradesProps) {
  const [trades, setTrades] = useState<Trade[]>(initial);
  const [loading, setLoading] = useState(initial.length === 0);

  useEffect(() => {
    const ws = getWsClient();
    const unsub = ws.on('trade', (payload) => {
      const p = payload as { symbol?: string; trade?: Trade };
      if (p?.symbol === symbol && p.trade) {
        setTrades((prev) => [p.trade!, ...prev].slice(0, 30));
      }
    });
    ws.subscribe('trades', { symbol });
    const t = setTimeout(() => setLoading(false), 500);
    return () => {
      unsub();
      ws.unsubscribe('trades');
      clearTimeout(t);
    };
  }, [symbol]);

  if (loading) return <Skeleton className="h-[400px] w-full" />;

  return (
    <div className="rounded-md border bg-card text-sm font-mono">
      <div className="grid grid-cols-3 px-3 py-2 text-[10px] uppercase text-muted-foreground border-b">
        <div>Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Time</div>
      </div>
      <div className="px-3 py-1 max-h-[400px] overflow-y-auto">
        {trades.length === 0 && <div className="text-center text-muted-foreground py-6 text-xs">No trades yet</div>}
        {trades.map((t) => (
          <div key={t.id} className="grid grid-cols-3 py-0.5 text-xs">
            <span className={cn(t.side === 'buy' ? 'text-success' : 'text-destructive')}>
              {t.price.toFixed(t.price < 0.01 ? 6 : 4)}
            </span>
            <span className="text-right">{formatNumber(t.size, { maximumFractionDigits: 2 })}</span>
            <span className="text-right text-muted-foreground">
              {new Date(t.ts).toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
