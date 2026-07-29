'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CandlestickChart } from '@/components/market/candlestick-chart';
import { OrderBook } from '@/components/market/order-book';
import { RecentTrades } from '@/components/market/recent-trades';
import { TradeForm } from '@/components/market/trade-form';
import { BondingCurveMeter } from '@/components/market/bonding-curve-meter';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { ArrowLeft, Share2, Star } from 'lucide-react';
import Link from 'next/link';
import { formatNumber, formatPercent } from '@/lib/utils';

export default function LaunchpadTokenPage() {
  const params = useParams<{ symbol: string }>();
  const router = useRouter();
  const symbol = (params?.symbol || '').toUpperCase();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');

  const { data, isLoading } = useQuery({
    queryKey: ['launchpad-token', symbol],
    queryFn: async () => {
      try {
        return await api.get<any>(`/api/launchpad/tokens/${symbol}`);
      } catch {
        return FALLBACK(symbol);
      }
    },
  });

  if (isLoading || !data) {
    return (
      <div className="container py-8 space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9">
          <Link href="/launchpad"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-emerald-300 flex items-center justify-center text-primary-foreground font-bold">
          {data.symbol.slice(0, 2)}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">${data.symbol} · launched {new Date(data.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon"><Star className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon"><Share2 className="h-4 w-4" /></Button>
        <Button asChild><Link href={`/trade/${data.symbol}`}>Open in trade</Link></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Market cap" value={`$${formatNumber(data.marketCap)}`} />
        <KPI label="24h Volume" value={`$${formatNumber(data.volume24h)}`} />
        <KPI label="Holders" value={formatNumber(data.holders)} />
        <KPI label="24h Change" value={formatPercent(data.change24h)} positive={data.change24h >= 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px_320px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-2">
              <CandlestickChart data={data.candles} height={360} />
            </CardContent>
          </Card>
          {!data.graduated && (
            <BondingCurveMeter
              progress={data.bondingProgress}
              currentPrice={data.price}
              nextThreshold={data.price * 1.05}
              raised={data.raised}
              target={data.target}
              graduated={data.graduated}
            />
          )}
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="holders">Holders</TabsTrigger>
              <TabsTrigger value="tx">Transactions</TabsTrigger>
            </TabsList>
            <TabsContent value="comments"><Comments symbol={symbol} /></TabsContent>
            <TabsContent value="holders"><Holders symbol={symbol} /></TabsContent>
            <TabsContent value="tx"><Txns symbol={symbol} /></TabsContent>
          </Tabs>
        </div>

        <div><OrderBook bids={data.bids} asks={data.asks} precision={data.price < 0.01 ? 6 : 4} /></div>
        <div><TradeForm symbol={symbol} side={side} onSideChange={setSide} marketPrice={data.price} /></div>
      </div>
    </div>
  );
}

function KPI({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-semibold ${positive === undefined ? '' : positive ? 'text-success' : 'text-destructive'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Comments({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ['comments', symbol],
    queryFn: async () => {
      try {
        return await api.get<Array<{ id: string; user: string; text: string; ts: number }>>(`/api/launchpad/tokens/${symbol}/comments`);
      } catch {
        return [
          { id: '1', user: 'trader42', text: 'Looking strong!', ts: Date.now() - 60000 },
          { id: '2', user: 'moonboi', text: 'Just aped in. LFG!', ts: Date.now() - 120000 },
          { id: '3', user: 'skeptik', text: 'Creator wallet concentration is high. Be careful.', ts: Date.now() - 180000 },
        ];
      }
    },
  });
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {(data || []).map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium">@{c.user}</span>
            <span className="text-muted-foreground text-xs ml-2">{new Date(c.ts).toLocaleTimeString()}</span>
            <p className="text-muted-foreground">{c.text}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Holders({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ['holders', symbol],
    queryFn: async () => {
      try {
        return await api.get<any[]>(`/api/launchpad/tokens/${symbol}/holders`);
      } catch {
        return Array.from({ length: 8 }).map((_, i) => ({
          address: '0x' + Math.random().toString(16).slice(2, 10),
          pct: 25 - i * 2.8,
        }));
      }
    },
  });
  return (
    <Card>
      <CardContent className="p-0">
        {(data || []).map((h, i) => (
          <div key={i} className="flex justify-between px-4 py-2 text-sm border-b last:border-0">
            <span className="font-mono">{h.address}</span>
            <span className="font-mono">{h.pct.toFixed(2)}%</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Txns({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ['txns', symbol],
    queryFn: async () => {
      try {
        return await api.get<any[]>(`/api/launchpad/tokens/${symbol}/transactions`);
      } catch {
        return Array.from({ length: 8 }).map((_, i) => ({
          type: i % 2 === 0 ? 'buy' : 'sell',
          amount: Math.random() * 1000,
          user: '0x' + Math.random().toString(16).slice(2, 10),
          ts: Date.now() - i * 30000,
        }));
      }
    },
  });
  return (
    <Card>
      <CardContent className="p-0">
        {(data || []).map((t, i) => (
          <div key={i} className="grid grid-cols-3 px-4 py-2 text-sm border-b last:border-0">
            <span className={t.type === 'buy' ? 'text-success' : 'text-destructive'}>{t.type.toUpperCase()}</span>
            <span className="font-mono">{t.amount.toFixed(2)}</span>
            <span className="font-mono text-muted-foreground text-xs">{t.user}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FALLBACK(symbol: string) {
  const price = 0.0123;
  const candles = Array.from({ length: 60 }).map((_, i) => {
    const t = Math.floor(Date.now() / 1000) - (60 - i) * 900;
    const o = price + (Math.random() - 0.5) * 0.002;
    const c = o + (Math.random() - 0.5) * 0.001;
    return { time: t as never, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c };
  });
  const bids = Array.from({ length: 10 }).map((_, i) => ({ price: price - i * 0.0001, size: Math.random() * 1000 }));
  const asks = Array.from({ length: 10 }).map((_, i) => ({ price: price + i * 0.0001, size: Math.random() * 1000 }));
  return {
    id: symbol,
    symbol,
    name: symbol,
    description: 'A demo launchpad token.',
    price,
    marketCap: 1_230_000,
    volume24h: 89_000,
    change24h: 4.2,
    holders: 412,
    bondingProgress: 64,
    raised: 64000,
    target: 100000,
    graduated: false,
    createdAt: new Date().toISOString(),
    candles,
    bids,
    asks,
  };
}
