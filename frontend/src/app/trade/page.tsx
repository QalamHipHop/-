import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingTokens } from '@/components/market/trending-tokens';
import { Button } from '@/components/ui/button';
import { ArrowRight, Flame, BarChart3, Shield } from 'lucide-react';

export default function TradePage() {
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
        <KPI label="24h Volume" value="$1.24M" change={8.2} icon={<BarChart3 className="h-4 w-4" />} />
        <KPI label="Active tokens" value="1,284" change={2.1} icon={<Flame className="h-4 w-4" />} />
        <KPI label="Open orders" value="14,902" change={-1.4} icon={<BarChart3 className="h-4 w-4" />} />
        <KPI label="Risk-flagged" value="37" change={-12.5} icon={<Shield className="h-4 w-4" />} />
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

function KPI({ label, value, change, icon }: { label: string; value: string; change: number; icon: React.ReactNode }) {
  const positive = change >= 0;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon} {label}</div>
        <div className="text-2xl font-bold">{value}</div>
        <Badge variant={positive ? 'success' : 'destructive'} className="mt-1 text-[10px]">
          {positive ? '+' : ''}{change.toFixed(2)}%
        </Badge>
      </CardContent>
    </Card>
  );
}
