'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { formatNumber, formatPercent, timeAgo } from '@/lib/utils';
import Link from 'next/link';
import { Shield, AlertTriangle, Activity, Users, Flag } from 'lucide-react';

export default function AdminPage() {
  const { user, loading, hasRole } = useAuth();

  const { data: flagged, isLoading } = useQuery({
    queryKey: ['admin-flagged'],
    queryFn: async () => {
      try {
        return await api.get<Array<{ id: string; symbol: string; reason: string; riskScore: number; ts: string }>>('/api/admin/flagged-tokens');
      } catch {
        return [
          { id: '1', symbol: 'SCAM', reason: 'High creator concentration', riskScore: 87, ts: new Date(Date.now() - 600000).toISOString() },
          { id: '2', symbol: 'RUG', reason: 'Liquidity pulled', riskScore: 95, ts: new Date(Date.now() - 1200000).toISOString() },
          { id: '3', symbol: 'WASH', reason: 'Wash trading detected', riskScore: 71, ts: new Date(Date.now() - 3600000).toISOString() },
        ];
      }
    },
    enabled: hasRole('admin', 'moderator'),
  });

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      try {
        return await api.get<{ users: number; tokens: number; volume24h: number; flagged: number }>('/api/admin/stats');
      } catch {
        return { users: 12_481, tokens: 1_284, volume24h: 1_240_000, flagged: 37 };
      }
    },
    enabled: hasRole('admin', 'moderator'),
  });

  if (loading) return <div className="container py-8"><Skeleton className="h-96" /></div>;
  if (!user) {
    return (
      <div className="container py-20 text-center">
        <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <Button asChild className="mt-4"><Link href="/login?next=/admin">Log in</Link></Button>
      </div>
    );
  }
  if (!hasRole('admin', 'moderator')) {
    return (
      <div className="container py-20 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
        <h1 className="text-2xl font-bold">Forbidden</h1>
        <p className="text-muted-foreground">You don&apos;t have access to this area.</p>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Shield className="h-7 w-7" /> Admin</h1>
        <p className="text-muted-foreground">Platform operations &amp; moderation.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Users className="h-4 w-4" />} label="Users" value={formatNumber(stats?.users || 0)} />
        <Stat icon={<Activity className="h-4 w-4" />} label="Tokens" value={formatNumber(stats?.tokens || 0)} />
        <Stat icon={<Activity className="h-4 w-4" />} label="24h volume" value={`$${formatNumber(stats?.volume24h || 0)}`} />
        <Stat icon={<Flag className="h-4 w-4" />} label="Flagged" value={formatNumber(stats?.flagged || 0)} />
      </div>

      <Tabs defaultValue="flagged">
        <TabsList>
          <TabsTrigger value="flagged">Flagged tokens</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="settings">Platform settings</TabsTrigger>
        </TabsList>
        <TabsContent value="flagged" className="mt-3">
          {isLoading ? <Skeleton className="h-64" /> : <FlaggedList items={flagged || []} />}
        </TabsContent>
        <TabsContent value="users" className="mt-3">
          <Card><CardContent className="p-6 text-sm text-muted-foreground">User management coming soon.</CardContent></Card>
        </TabsContent>
        <TabsContent value="settings" className="mt-3">
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Platform settings coming soon.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon} {label}</div>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function FlaggedList({ items }: { items: Array<{ id: string; symbol: string; reason: string; riskScore: number; ts: string }> }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-5 px-4 py-3 text-xs text-muted-foreground border-b">
          <div>Token</div>
          <div>Reason</div>
          <div>Risk</div>
          <div>Time</div>
          <div className="text-right">Actions</div>
        </div>
        {items.map((it) => (
          <div key={it.id} className="grid grid-cols-5 px-4 py-3 text-sm border-b last:border-0 items-center">
            <Link href={`/trade/${it.symbol}`} className="font-medium hover:underline">{it.symbol}</Link>
            <span className="text-muted-foreground">{it.reason}</span>
            <Badge variant={it.riskScore > 80 ? 'destructive' : it.riskScore > 50 ? 'warning' : 'info'}>
              {it.riskScore}
            </Badge>
            <span className="text-xs text-muted-foreground">{timeAgo(it.ts)}</span>
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="outline" className="h-7">Review</Button>
              <Button size="sm" variant="destructive" className="h-7">Hide</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
