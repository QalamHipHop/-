'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { formatNumber, formatPercent } from '@/lib/utils';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, History, LogIn } from 'lucide-react';

interface Order {
  id: string;
  marketId?: string;
  market_id?: string;
  side: 'buy' | 'sell';
  type: string;
  amountMinor?: string;
  amount_minor?: string;
  filledMinor?: string;
  filled_minor?: string;
  priceMinor?: string;
  price_minor?: string;
  status: string;
  createdAt?: string;
  created_at?: string;
}

interface Position {
  symbol: string;
  name: string;
  amount: number;
  price: number;
  value: number;
  pnl: number;
  pnlPct: number;
}

export default function PortfolioPage() {
  const { user, loading } = useAuth();
  const { data: positions, isLoading, isError: positionsError } = useQuery({
    queryKey: ['positions'],
    queryFn: () => api.get<Position[]>('/api/portfolio/positions'),
    enabled: !!user,
  });

  const { data: balance, isError: balanceError } = useQuery({
    queryKey: ['rial-balance'],
    queryFn: () => api.get<{ available: number; total: number }>('/api/wallet/balance', { query: { asset: 'RIAL' } }),
    enabled: !!user,
  });

  const queryClient = useQueryClient();
  const ordersQuery = useQuery({
    queryKey: ['user-orders'],
    queryFn: () => api.get<Order[]>('/api/trading/orders', { query: { limit: 50 } }),
    enabled: !!user,
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => api.delete(`/api/trading/orders/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-orders'] }),
  });

  if (loading) return <div className="container py-8"><Skeleton className="h-96" /></div>;
  if (!user) {
    return (
      <div className="container py-20 text-center">
        <LogIn className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">Sign in to view your portfolio</h1>
        <Button asChild><Link href="/login?next=/portfolio">Log in</Link></Button>
      </div>
    );
  }

  const totalValue = (balance?.total || 0) + (positions || []).reduce((s, p) => s + p.value, 0);
  const totalPnl = (positions || []).reduce((s, p) => s + p.pnl, 0);

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Portfolio</h1>
          <p className="text-muted-foreground">Your holdings, orders, and history.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/portfolio/funding"><ArrowDownToLine className="mr-2 h-4 w-4" /> Deposit</Link></Button>
          <Button asChild variant="outline"><Link href="/portfolio/funding"><ArrowUpFromLine className="mr-2 h-4 w-4" /> Withdraw</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Total balance</div>
            <div className="text-3xl font-bold mt-1">{formatNumber(totalValue)} RIAL</div>
            <div className={`text-xs mt-1 ${totalPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatNumber(Math.abs(totalPnl))} RIAL ({formatPercent((totalPnl / Math.max(1, totalValue - totalPnl)) * 100)})
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Available (﷼)</div>
            {balanceError ? <div className="text-sm text-destructive mt-2">Balance unavailable</div> : <div className="text-3xl font-bold mt-1">{formatNumber(balance?.available || 0)}</div>}
            <div className="text-xs text-muted-foreground mt-1">Settlement token</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Positions</div>
            <div className="text-3xl font-bold mt-1">{(positions || []).length}</div>
            <div className="text-xs text-muted-foreground mt-1">Across all markets</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings"><Wallet className="mr-1 h-3.5 w-3.5" /> Holdings</TabsTrigger>
          <TabsTrigger value="orders"><History className="mr-1 h-3.5 w-3.5" /> Open orders</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings" className="mt-3">
          {isLoading ? <Skeleton className="h-64" /> : positionsError ? <Unavailable label="Portfolio positions are temporarily unavailable" /> : <Holdings positions={positions || []} />}
        </TabsContent>
        <TabsContent value="orders" className="mt-3">
          {ordersQuery.isLoading ? <Skeleton className="h-64" /> : ordersQuery.isError ? <Unavailable label="Open orders are temporarily unavailable" /> : <Orders orders={(ordersQuery.data || []).filter((order) => !['filled', 'cancelled', 'rejected'].includes(order.status))} onCancel={(id) => cancelOrder.mutate(id)} cancelling={cancelOrder.isPending} />}
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          {ordersQuery.isLoading ? <Skeleton className="h-64" /> : ordersQuery.isError ? <Unavailable label="Order history is temporarily unavailable" /> : <Orders orders={ordersQuery.data || []} onCancel={() => undefined} cancelling={false} history />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{label}. No synthetic data is shown.</CardContent></Card>;
}

function Orders({ orders, onCancel, cancelling, history = false }: { orders: Order[]; onCancel: (id: string) => void; cancelling: boolean; history?: boolean }) {
  if (orders.length === 0) return <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">{history ? 'No order history.' : 'No open orders.'}</CardContent></Card>;
  return <Card><CardContent className="p-0 divide-y">{orders.map((order) => {
    const market = order.marketId || order.market_id || 'Unknown market';
    const amount = order.amountMinor || order.amount_minor || '—';
    const price = order.priceMinor || order.price_minor || 'market';
    return <div key={order.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div><div className="font-medium">{market} <span className={order.side === 'buy' ? 'text-success' : 'text-destructive'}>{order.side.toUpperCase()}</span></div><div className="text-xs text-muted-foreground">{order.type} · amount {amount} · price {price}</div></div>
      <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{order.status}</span>{!history && !['filled', 'cancelled', 'rejected'].includes(order.status) && <Button variant="outline" size="sm" disabled={cancelling} onClick={() => onCancel(order.id)}>Cancel</Button>}</div>
    </div>;
  })}</CardContent></Card>;
}

function Holdings({ positions }: { positions: Position[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-5 px-4 py-3 text-xs text-muted-foreground border-b">
          <div>Asset</div>
          <div className="text-right">Balance</div>
          <div className="text-right">Price</div>
          <div className="text-right">Value</div>
          <div className="text-right">P&amp;L</div>
        </div>
        {positions.map((p) => (
          <Link
            key={p.symbol}
            href={`/trade/${p.symbol}`}
            className="grid grid-cols-5 px-4 py-3 text-sm border-b last:border-0 hover:bg-muted/40 transition-colors"
          >
            <div>
              <div className="font-medium">{p.symbol}</div>
              <div className="text-xs text-muted-foreground">{p.name}</div>
            </div>
            <div className="text-right font-mono">{formatNumber(p.amount, { maximumFractionDigits: 2 })}</div>
            <div className="text-right font-mono">{p.price.toFixed(4)} RIAL</div>
            <div className="text-right font-mono">{formatNumber(p.value)} RIAL</div>
            <div className={`text-right font-mono ${p.pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {p.pnl >= 0 ? '+' : ''}{formatNumber(Math.abs(p.pnl))} RIAL ({formatPercent(p.pnlPct)})
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
