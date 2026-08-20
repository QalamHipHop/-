'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingTokens } from '@/components/market/trending-tokens';
import { Button } from '@/components/ui/button';
import { ArrowRight, Flame, BarChart3, Shield } from 'lucide-react';

export default function TradePage() {
  const { data: stats, isError } = useQuery({
    queryKey: ['market-overview-stats'],
    queryFn: () => api.get<{ volume24h: number | null; activeTokens: number | null; openOrders: number | null; riskFlagged: number | null; changes?: Record<string, number> }>('/api/trading/overview'),
  });

  const value = (key: 'volume24h' | 'activeTokens' | 'openOrders' | 'riskFlagged', fallback = 'Unavailable') => {
    if (isError || !stats) return fallback;
    const raw = stats[key];
    if (raw === null || raw === undefined) return fallback;
    return key === 'volume24h' ? `${(raw / 1_000_000).toFixed(2)}M ﷼` : raw.toLocaleString();
  };
  const change = (key: string) => stats?.changes?.[key] ?? 0;

  return (
    <div className="container py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Markets</h1>
          <p className="text-muted-foreground">Real-time order books, charts, and trades for every token.</p>
        </div>
        <Button asChild>
          <Link href="/launchpad"><Flame className="mr-2 h-4 w-4" /> Launch a token</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KPI label="24h Volume" value={value('volume24h')} change={change('volume24h')} icon={<BarChart3 className="h-4 w-4" />} unavailable={isError || !stats} />
        <KPI label="Active tokens" value={value('activeTokens')} change={change('activeTokens')} icon={<Flame className="h-4 w-4" />} unavailable={isError || !stats} />
        <KPI label="Open orders" value={value('openOrders')} change={change('openOrders')} icon={<BarChart3 className="h-4 w-4" />} unavailable={isError || !stats} />
        <KPI label="Risk-flagged" value={value('riskFlagged')} change={change('riskFlagged')} icon={<Shield className="h-4 w-4" />} unavailable={isError || !stats || stats.riskFlagged === null} />
      </div>

      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="text-xl font-semibold">Trending</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/launchpad">View all <ArrowRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </div>
        <TrendingTokens />
      </section>
    </div>
  );
}

function KPI({ label, value, change, icon, unavailable }: { label: string; value: string; change: number; icon: React.ReactNode; unavailable: boolean }) {
  const positive = change >= 0;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon} {label}</div>
        <div className="text-2xl font-bold">{value}</div>
        {unavailable ? <div className="text-xs text-muted-foreground mt-2">Live data unavailable</div> : <Badge variant={positive ? 'success' : 'destructive'} className="mt-1 text-[10px]">
          {positive ? '+' : ''}{change.toFixed(2)}%
        </Badge>}
      </CardContent>
    </Card>
  );
}
