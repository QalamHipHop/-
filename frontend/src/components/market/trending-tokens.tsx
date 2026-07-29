'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatNumber, formatPercent, timeAgo } from '@/lib/utils';
import { TrendingUp, Users, Activity } from 'lucide-react';

interface TrendingToken {
  id: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  holders: number;
  graduated: boolean;
  createdAt: string;
  riskScore?: number;
}

const FALLBACK: TrendingToken[] = [
  { id: '1', symbol: 'RIALS', name: 'Rial Index', price: 0.4234, change24h: 12.4, volume24h: 234567, marketCap: 4_200_000, holders: 1284, graduated: true, createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), riskScore: 12 },
  { id: '2', symbol: 'GALAXY', name: 'Galactic', price: 0.0089, change24h: -3.2, volume24h: 89432, marketCap: 890_000, holders: 712, graduated: false, createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), riskScore: 28 },
  { id: '3', symbol: 'MOON', name: 'MoonShot', price: 0.1245, change24h: 28.9, volume24h: 1456789, marketCap: 12_400_000, holders: 4521, graduated: true, createdAt: new Date(Date.now() - 86400000 * 12).toISOString(), riskScore: 8 },
  { id: '4', symbol: 'NEON', name: 'Neon Pulse', price: 1.872, change24h: 5.6, volume24h: 543210, marketCap: 18_700_000, holders: 982, graduated: true, createdAt: new Date(Date.now() - 86400000 * 25).toISOString(), riskScore: 5 },
  { id: '5', symbol: 'BOLT', name: 'Lightning', price: 0.0567, change24h: 15.7, volume24h: 198765, marketCap: 5_670_000, holders: 2103, graduated: false, createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), riskScore: 22 },
  { id: '6', symbol: 'PEPE2', name: 'Pepe Two', price: 0.00002, change24h: -12.1, volume24h: 678901, marketCap: 2_000_000, holders: 8765, graduated: true, createdAt: new Date(Date.now() - 86400000 * 45).toISOString(), riskScore: 45 },
];

export function TrendingTokens() {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-tokens'],
    queryFn: async () => {
      try {
        return await api.get<TrendingToken[]>('/api/tokens/trending');
      } catch {
        return FALLBACK;
      }
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {(data || []).map((t) => (
        <Link key={t.id} href={`/trade/${t.symbol}`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/60 to-emerald-300/60 flex items-center justify-center font-bold text-primary-foreground text-sm">
                    {t.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.symbol}</span>
                      {t.graduated && <Badge variant="success" className="text-[10px] h-4">Grad</Badge>}
                      {t.riskScore !== undefined && (
                        <Badge
                          variant={t.riskScore < 20 ? 'success' : t.riskScore < 50 ? 'warning' : 'destructive'}
                          className="text-[10px] h-4"
                        >
                          Risk {t.riskScore}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{t.name}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${t.change24h >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatPercent(t.change24h)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat icon={<Activity className="h-3 w-3" />} label="Vol 24h" value={'$' + formatNumber(t.volume24h)} />
                <Stat icon={<TrendingUp className="h-3 w-3" />} label="MCap" value={'$' + formatNumber(t.marketCap)} />
                <Stat icon={<Users className="h-3 w-3" />} label="Holders" value={formatNumber(t.holders)} />
              </div>
              <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground flex items-center justify-between">
                <span>${t.price < 0.01 ? t.price.toFixed(6) : t.price.toFixed(4)}</span>
                <span>{timeAgo(t.createdAt)}</span>
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
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
        {icon} {label}
      </div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
