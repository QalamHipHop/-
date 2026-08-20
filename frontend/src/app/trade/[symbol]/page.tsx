'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { CandlestickChart, type Candle } from '@/components/market/candlestick-chart';
import { OrderBook, type OrderBookLevel } from '@/components/market/order-book';
import { RecentTrades, type Trade } from '@/components/market/recent-trades';
import { TradeForm } from '@/components/market/trade-form';
import { BondingCurveMeter } from '@/components/market/bonding-curve-meter';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/auth-provider';
import { getWsClient } from '@/lib/ws';
import { ArrowLeft, Star, Share2 } from 'lucide-react';
import Link from 'next/link';
import { formatNumber, formatPercent } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

interface DepthPayload {
  symbol?: string;
  market_id?: string;
  bids?: Array<{ price?: number | string; price_minor?: number | string; size?: number | string; amount_minor?: number | string; total?: number | string }>;
  asks?: Array<{ price?: number | string; price_minor?: number | string; size?: number | string; amount_minor?: number | string; total?: number | string }>;
}

const FIXED_POINT_DECIMALS = 8;

function displayAmount(value: number | string | undefined, isMinor: boolean): number {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return NaN;
  return isMinor ? numeric / 10 ** FIXED_POINT_DECIMALS : numeric;
}

function normalizeDepth(levels: DepthPayload['bids']): OrderBookLevel[] {
  return (levels ?? []).map((level) => ({
    // Backend authoritative contracts expose *_minor as fixed-point strings.
    // Convert only at the presentation boundary; order submission remains string-based.
    price: displayAmount(level.price ?? level.price_minor, level.price === undefined),
    size: displayAmount(level.size ?? level.amount_minor, level.size === undefined),
    total: level.total === undefined ? undefined : displayAmount(level.total, false),
  })).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size));
}

interface UserOrder {
  id: string;
  marketId?: string;
  market_id?: string;
  side: 'buy' | 'sell';
  type: string;
  amountMinor?: string;
  amount_minor?: string;
  priceMinor?: string;
  price_minor?: string;
  status: string;
}

interface TokenMeta {
  id: string;
  symbol: string;
  name: string;
  description: string;
  logoUrl?: string;
  graduated: boolean;
  bondingProgress: number;
  raised: number;
  target: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  holders: number;
  riskScore?: number;
  creator: string;
  createdAt: string;
  socials?: { website?: string; twitter?: string; telegram?: string };
}

export default function TradePairPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol || 'RIALS').toUpperCase();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [tf, setTf] = useState<typeof TIMEFRAMES[number]>('15m');
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [lastPrice, setLastPrice] = useState(0);
  const { user } = useAuth();
  const { t } = useI18n();

  const { data: meta, isLoading: metaLoading, isError: metaError } = useQuery({
    queryKey: ['token-meta', symbol],
    queryFn: () => api.get<TokenMeta>(`/api/tokens/${symbol}`),
  });

  const { data: initialDepth } = useQuery({
    queryKey: ['orderbook', symbol],
    queryFn: () => api.get<DepthPayload>(`/api/trading/markets/${symbol}/orderbook`, { query: { depth: 20 } }),
    refetchInterval: 30_000,
  });

  const { data: userOrders, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ['user-orders', symbol],
    queryFn: () => api.get<UserOrder[]>('/api/trading/orders', { query: { marketId: symbol, limit: 50 } }),
    enabled: !!user,
  });

  const { data: candles, isError: candlesError } = useQuery({
    queryKey: ['candles', symbol, tf],
    queryFn: () => api.get<Candle[]>(`/api/tokens/${symbol}/candles`, { query: { tf, limit: 200 } }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (initialDepth) {
      setOrderBook({ bids: normalizeDepth(initialDepth.bids), asks: normalizeDepth(initialDepth.asks) });
    }
  }, [initialDepth]);

  // WebSocket live data
  useEffect(() => {
    const ws = getWsClient();
    const offDepth = ws.on('depth', (payload) => {
      const p = payload as DepthPayload;
      const matchesMarket = p.symbol === symbol || p.market_id === symbol;
      if (matchesMarket && p.bids && p.asks) {
        setOrderBook({ bids: normalizeDepth(p.bids), asks: normalizeDepth(p.asks) });
      }
    });
    const offTrade = ws.on('trade', (payload) => {
      const p = payload as { symbol?: string; trade?: Trade };
      if (p.symbol === symbol && p.trade) {
        setTrades((prev) => [p.trade!, ...prev].slice(0, 30));
        setLastPrice(p.trade.price);
      }
    });
    ws.subscribe('depth', { symbol });
    ws.subscribe('trades', { symbol });
    return () => {
      offDepth();
      offTrade();
      ws.unsubscribe('depth');
      ws.unsubscribe('trades');
    };
  }, [symbol]);

  const pricePrecision = useMemo(() => (lastPrice < 0.01 ? 6 : 4), [lastPrice]);
  const changePositive = (meta?.change24h || 0) >= 0;

  return (
    <div className="container py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9">
          <Link href="/trade"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        {metaLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : metaError || !meta ? (
          <UnavailableNotice label={`Market data for ${symbol} is unavailable`} />
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-emerald-300 flex items-center justify-center text-primary-foreground font-bold">
              {meta?.symbol.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{meta?.symbol}</h1>
                <Button variant="ghost" size="icon" className="h-7 w-7"><Star className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"><Share2 className="h-3.5 w-3.5" /></Button>
              </div>
              <p className="text-sm text-muted-foreground">{meta?.name}</p>
            </div>
          </div>
        )}
        <div className="flex-1" />
        <div className="hidden md:flex gap-6 text-right">
          <Stat label={t('price')} value={lastPrice ? `${lastPrice.toFixed(pricePrecision)} ﷼` : '—'} positive={changePositive} />
          <Stat label="24h Change" value={formatPercent(meta?.change24h || 0)} positive={changePositive} />
          <Stat label="24h Volume" value={`${formatNumber(meta?.volume24h || 0)} ﷼`} />
          <Stat label="Market Cap" value={`${formatNumber(meta?.marketCap || 0)} ﷼`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px_320px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div className="flex items-center gap-2">
                {TIMEFRAMES.map((t) => (
                  <Button key={t} size="sm" variant={tf === t ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setTf(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-2">
              {candles ? <CandlestickChart data={candles} height={420} /> : candlesError ? <UnavailableNotice label="Candles are temporarily unavailable" /> : <Skeleton className="h-[420px] w-full" />}
            </CardContent>
          </Card>

          {meta && !meta.graduated && lastPrice > 0 && (
            <BondingCurveMeter
              progress={meta.bondingProgress}
              currentPrice={lastPrice}
              nextThreshold={lastPrice * 1.05}
              raised={meta.raised}
              target={meta.target}
              graduated={meta.graduated}
            />
          )}

          <Tabs defaultValue="trades" className="w-full">
            <TabsList>
              <TabsTrigger value="trades">{t('trades')}</TabsTrigger>
              <TabsTrigger value="orders">{t('myOrders')}</TabsTrigger>
              <TabsTrigger value="holders">{t('holders')}</TabsTrigger>
              <TabsTrigger value="info">{t('info')}</TabsTrigger>
            </TabsList>
            <TabsContent value="trades" className="mt-3"><RecentTrades symbol={symbol} initial={trades} /></TabsContent>
            <TabsContent value="orders" className="mt-3"><MarketOrders orders={userOrders || []} loading={ordersLoading} error={ordersError} signedIn={!!user} /></TabsContent>
            <TabsContent value="holders" className="mt-3"><HoldersList symbol={symbol} /></TabsContent>
            <TabsContent value="info" className="mt-3"><TokenInfo meta={meta} loading={metaLoading} /></TabsContent>
          </Tabs>
        </div>

        <div className="order-3 lg:order-2">
          <OrderBook
            bids={orderBook.bids}
            asks={orderBook.asks}
            precision={pricePrecision}
            onSelectPrice={(p) => {
              const el = document.getElementById('price-input') as HTMLInputElement | null;
              if (el) el.value = p.toString();
            }}
          />
        </div>

        <div className="order-2 lg:order-3">
          <TradeForm symbol={symbol} side={side} onSideChange={setSide} marketPrice={lastPrice} />
        </div>
      </div>
    </div>
  );
}

function MarketOrders({ orders, loading, error, signedIn }: { orders: UserOrder[]; loading: boolean; error: boolean; signedIn: boolean }) {
  if (!signedIn) return <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">Sign in to view your orders.</CardContent></Card>;
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <UnavailableNotice label="Your orders are temporarily unavailable" />;
  if (orders.length === 0) return <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No orders for this market.</CardContent></Card>;
  return <Card><CardContent className="p-0 divide-y">{orders.map((order) => <div key={order.id} className="flex items-center justify-between px-4 py-3 text-sm"><div><span className={order.side === 'buy' ? 'text-success' : 'text-destructive'}>{order.side.toUpperCase()}</span> <span>{order.type}</span><div className="text-xs text-muted-foreground">Amount {order.amountMinor || order.amount_minor || '—'} · Price {order.priceMinor || order.price_minor || 'market'}</div></div><span className="text-xs text-muted-foreground">{order.status}</span></div>)}</CardContent></Card>;
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${positive === undefined ? '' : positive ? 'text-success' : 'text-destructive'}`}>
        {value}
      </div>
    </div>
  );
}

function HoldersList({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['holders', symbol],
    queryFn: () => api.get<Array<{ address: string; balance: number; pct: number }>>(`/api/tokens/${symbol}/holders`),
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) return <UnavailableNotice label="Holder data is temporarily unavailable" />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-3 px-4 py-2 text-xs text-muted-foreground border-b">
          <div>Address</div><div className="text-right">Balance</div><div className="text-right">%</div>
        </div>
        {(data || []).map((h, i) => (
          <div key={i} className="grid grid-cols-3 px-4 py-2 text-sm font-mono">
            <span>{h.address.slice(0, 6)}…{h.address.slice(-4)}</span>
            <span className="text-right">{formatNumber(h.balance)}</span>
            <span className="text-right text-muted-foreground">{h.pct.toFixed(2)}%</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TokenInfo({ meta, loading }: { meta?: TokenMeta; loading: boolean }) {
  if (loading || !meta) return <Skeleton className="h-64" />;
  return (
    <Card>
      <CardContent className="p-4 space-y-3 text-sm">
        <p className="text-muted-foreground">{meta.description}</p>
        <div className="grid grid-cols-2 gap-3">
          <Row label="Creator" value={`${meta.creator.slice(0, 6)}…${meta.creator.slice(-4)}`} />
          <Row label="Created" value={new Date(meta.createdAt).toLocaleDateString()} />
          <Row label="Holders" value={formatNumber(meta.holders)} />
          <Row label="Risk Score" value={meta.riskScore !== undefined ? `${meta.riskScore}/100` : '—'} />
        </div>
        {meta.socials && (
          <div className="flex gap-2 pt-2">
            {meta.socials.website && <a href={meta.socials.website} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">Website</a>}
            {meta.socials.twitter && <a href={meta.socials.twitter} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">Twitter</a>}
            {meta.socials.telegram && <a href={meta.socials.telegram} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">Telegram</a>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function UnavailableNotice({ label }: { label: string }) {
  return <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{label}. No synthetic data is shown.</CardContent></Card>;
}
