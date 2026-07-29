'use client';

import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface OrderBookLevel {
  price: number;
  size: number;
  total?: number;
}

interface OrderBookProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  loading?: boolean;
  precision?: number;
  onSelectPrice?: (price: number) => void;
}

export function OrderBook({ bids, asks, loading, precision = 4, onSelectPrice }: OrderBookProps) {
  const { maxSize, reversedAsks, sortedBids } = useMemo(() => {
    const sortedBids = [...bids].sort((a, b) => b.price - a.price);
    const reversedAsks = [...asks].sort((a, b) => a.price - b.price);
    const maxSize = Math.max(...bids.map((b) => b.size), ...asks.map((a) => a.size), 1);
    return { sortedBids, reversedAsks, maxSize };
  }, [bids, asks]);

  if (loading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  const askRows = reversedAsks.slice(0, 12);
  const bidRows = sortedBids.slice(0, 12);
  const spread = askRows.length && bidRows.length ? askRows[0].price - bidRows[0].price : 0;
  const spreadPct = bidRows[0] ? (spread / bidRows[0].price) * 100 : 0;

  return (
    <div className="rounded-md border bg-card text-sm font-mono">
      <div className="grid grid-cols-3 px-3 py-2 text-[10px] uppercase text-muted-foreground border-b">
        <div>Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Total</div>
      </div>
      <div className="px-3 py-1 space-y-px">
        {askRows.reverse().map((l, i) => (
          <Row key={`a-${i}`} level={l} side="ask" maxSize={maxSize} precision={precision} onClick={() => onSelectPrice?.(l.price)} />
        ))}
      </div>
      <div className="px-3 py-2 border-y bg-muted/30 text-center text-xs">
        Spread: <span className="text-foreground">{spread.toFixed(precision)}</span>{' '}
        <span className="text-muted-foreground">({spreadPct.toFixed(3)}%)</span>
      </div>
      <div className="px-3 py-1 space-y-px">
        {bidRows.map((l, i) => (
          <Row key={`b-${i}`} level={l} side="bid" maxSize={maxSize} precision={precision} onClick={() => onSelectPrice?.(l.price)} />
        ))}
      </div>
    </div>
  );
}

function Row({
  level,
  side,
  maxSize,
  precision,
  onClick,
}: {
  level: OrderBookLevel;
  side: 'ask' | 'bid';
  maxSize: number;
  precision: number;
  onClick: () => void;
}) {
  const pct = Math.min(100, (level.size / maxSize) * 100);
  const isBid = side === 'bid';
  return (
    <button
      onClick={onClick}
      className="relative grid grid-cols-3 w-full px-1 py-0.5 text-left hover:bg-muted/40 rounded-sm transition-colors"
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 right-0 pointer-events-none rounded-sm',
          isBid ? 'bg-success/15' : 'bg-destructive/15'
        )}
        style={{ width: `${pct}%` }}
      />
      <span className={cn('relative z-10', isBid ? 'text-success' : 'text-destructive')}>
        {level.price.toFixed(precision)}
      </span>
      <span className="relative z-10 text-right text-foreground">{formatNumber(level.size, { maximumFractionDigits: 2 })}</span>
      <span className="relative z-10 text-right text-muted-foreground">
        {formatNumber((level.total || level.size * level.price), { maximumFractionDigits: 2 })}
      </span>
    </button>
  );
}
