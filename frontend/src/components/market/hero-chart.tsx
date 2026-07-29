'use client';

import { useEffect, useMemo, useState } from 'react';
import { CandlestickChart, type Candle } from './candlestick-chart';
import { Badge } from '@/components/ui/badge';

function generateSampleCandles(count = 90, startPrice = 0.42): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Math.floor(Date.now() / 1000);
  const daySec = 86400;
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * daySec;
    const volatility = 0.08 + Math.random() * 0.05;
    const open = price;
    const direction = Math.random() > 0.45 ? 1 : -1;
    const change = (Math.random() - 0.5) * volatility * price;
    const close = Math.max(0.0001, open + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.04);
    const low = Math.min(open, close) * (1 - Math.random() * 0.04);
    candles.push({ time: t as never, open, high, low, close });
    price = close;
  }
  return candles;
}

export function HeroChart() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const data = useMemo(() => generateSampleCandles(), []);
  const last = data[data.length - 1];
  const first = data[0];
  const change = ((last.close - first.open) / first.open) * 100;
  const positive = change >= 0;

  return (
    <div className="relative rounded-xl border bg-card/50 backdrop-blur p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-emerald-300" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">RIALS / USD</span>
              <Badge variant="success" className="text-[10px]">Live</Badge>
            </div>
            <div className="text-xs text-muted-foreground">Rial index · bonding curve</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">${last.close.toFixed(4)}</div>
          <div className={positive ? 'text-xs text-success' : 'text-xs text-destructive'}>
            {positive ? '+' : ''}{change.toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="h-[280px]">
        {mounted ? <CandlestickChart data={data} height={280} /> : <div className="h-full w-full bg-muted/20 animate-pulse rounded" />}
      </div>
    </div>
  );
}
