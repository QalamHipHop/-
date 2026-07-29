'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { formatNumber, formatPercent } from '@/lib/utils';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, History, TrendingUp, LogIn } from 'lucide-react';

interface Position {
  symbol: string;
  name: string;
  amount: number;
  price: number;
  value: number;
  pnl: number;
  pnlPct: number;
}

const FALLBACK_POSITIONS: Position[] = [
  { symbol: 'RIALS', name: 'Rial Index', amount: 1240, price: 0.4234, value: 524.9, pnl: 64.2, pnlPct: 13.9 },
  { symbol: 'MOON', name: 'MoonShot', amount: 8400, price: 0.1245, value: 1045.8, pnl: 224.1, pnlPct: 27.3 },
  { symbol: 'NEON', name: 'Neon Pulse', amount: 50, price: 1.872, value: 93.6, pnl: 8.3, pnlPct: 9.7 },
  { symbol: 'BOLT', name: 'Lightning', amount: 1200, price: 0.0567, value: 68.0, pnl: -2.4, pnlPct: -3.4 },
];

export default function PortfolioPage() {
  const { user, loading } = useAuth();
  const { data: positions, isLoading } = useQuery({
    queryKey: ['positions'],
    queryFn: async () => {
      try {
        return await api.get<Position[]>('/api/portfolio/positions');
      } catch {
        return FALLBACK_POSITIONS;
      }
    },
    enabled: !!user,
  });

  const { data: balance } = useQuery({
    queryKey: ['rial-balance'],
    queryFn: async () => {
      try {
        return await api.get<{ available: number; total: number }>('/api/wallet/balance', { query: { asset: 'RIAL' } });
      } catch {
        return { available: 5_000, total: 5_240 };
      }
    },
    enabled: !!user,
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
          <Button variant="outline"><ArrowDownToLine className="mr-2 h-4 w-4" /> Deposit</Button>
          <Button variant="outline"><ArrowUpFromLine className="mr-2 h-4 w-4" /> Withdraw</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Total balance</div>
            <div className="text-3xl font-bold mt-1">${formatNumber(totalValue)}</div>
            <div className={`text-xs mt-1 ${totalPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {totalPnl >= 0 ? '+' : ''}${formatNumber(Math.abs(totalPnl))} ({formatPercent((totalPnl / Math.max(1, totalValue - totalPnl)) * 100)})
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Available (﷼)</div>
            <div className="text-3xl font-bold mt-1">{formatNumber(balance?.available || 0)}</div>
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
          {isLoading ? <Skeleton className="h-64" /> : <Holdings positions={positions || []} />}
        </TabsContent>
        <TabsContent value="orders" className="mt-3">
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">No open orders.</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">No recent trades.</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
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
            <div className="text-right font-mono">${p.price.toFixed(4)}</div>
            <div className="text-right font-mono">${formatNumber(p.value)}</div>
            <div className={`text-right font-mono ${p.pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {p.pnl >= 0 ? '+' : ''}${formatNumber(Math.abs(p.pnl))} ({formatPercent(p.pnlPct)})
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
