'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { Activity, Database, Layers } from 'lucide-react';

interface MarketSummary {
  id: string;
  chain: string;
  base_symbol: string;
  quote_symbol: string;
  kind: 'spot' | 'perp' | 'launch';
  token_id: string | null;
  tick_minor: string;
  lot_minor: string;
  status: 'active' | 'paused' | 'delisted';
  created_at: string;
}

export function TrendingTokens() {
  const { data, isLoading } = useQuery({
    queryKey: ['markets'],
    queryFn: async () => api.get<MarketSummary[]>('/api/trading/markets'),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (!data?.length) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">No live markets are available yet. Create a market and connect the trading database to populate this section.</CardContent></Card>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.map((market) => (
        <Link key={market.id} href={`/trade/${market.base_symbol}`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                    {market.base_symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{market.base_symbol}/{market.quote_symbol}</span>
                      <Badge variant={market.status === 'active' ? 'success' : 'warning'} className="text-[10px] h-4">{market.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{market.kind} · {market.chain}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat icon={<Activity className="h-3 w-3" />} label="Tick" value={market.tick_minor} />
                <Stat icon={<Layers className="h-3 w-3" />} label="Lot" value={market.lot_minor} />
                <Stat icon={<Database className="h-3 w-3" />} label="Token" value={market.token_id ? 'linked' : '—'} />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">{icon} {label}</div>
      <div className="font-mono font-medium truncate">{value}</div>
    </div>
  );
}
