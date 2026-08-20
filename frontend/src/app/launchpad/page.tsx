'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Flame, Search, Sparkles, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface LaunchpadToken {
  id: string;
  creator_id: string;
  chain: string;
  contract_address: string;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: string;
  description?: string;
  logo_url?: string;
  graduation_rial_minor: string;
  status: 'pending' | 'live' | 'paused' | 'rejected' | 'graduated' | string;
  graduated: boolean;
  created_at: string;
}

type TokenListResponse = { tokens?: LaunchpadToken[]; data?: { tokens?: LaunchpadToken[] } };

function extractTokens(payload: TokenListResponse): LaunchpadToken[] {
  return payload.tokens ?? payload.data?.tokens ?? [];
}

export default function LaunchpadPage() {
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const { t } = useI18n();
  const tokensQuery = useQuery({
    queryKey: ['launchpad-tokens'],
    queryFn: () => api.get<TokenListResponse>('/api/launchpad/tokens', { query: { limit: 100 } }),
    refetchInterval: 15_000,
  });

  const filtered = useMemo(() => {
    const tokens = extractTokens(tokensQuery.data ?? {});
    return tokens
      .filter((token) => {
        if (q && !`${token.symbol} ${token.name}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (tab === 'graduated') return token.graduated || token.status === 'graduated';
        if (tab === 'live') return token.status === 'live' && !token.graduated;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [q, tab, tokensQuery.data]);

  return (
    <div className="container py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Flame className="h-7 w-7 text-orange-500" /> {t('launchpad')}
          </h1>
          <p className="text-muted-foreground">{t('launchpadDescription')}</p>
        </div>
        <Button asChild size="lg">
          <Link href="/launchpad/new"><Sparkles className="mr-2 h-4 w-4" /> {t('launchTokenTitle')}</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t('searchTokens')} value={q} onChange={(event) => setQ(event.target.value)} className="pl-9" />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="new"><Clock className="mr-1 h-3.5 w-3.5" /> {t('newTokens')}</TabsTrigger>
              <TabsTrigger value="live">{t('live')}</TabsTrigger>
              <TabsTrigger value="graduated">{t('graduated')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsContent value={tab} className="mt-0">
          {tokensQuery.isLoading ? (
            <div className="text-center py-12 text-muted-foreground">{t('loadingLaunchpad')}</div>
          ) : tokensQuery.isError ? (
            <div className="text-center py-12 text-destructive">{t('launchpadUnavailable')}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((token) => <TokenCard key={token.id} token={token} />)}
              </div>
              {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground">{t('noLaunchpadMatches')}</div>}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TokenCard({ token }: { token: LaunchpadToken }) {
  const { t } = useI18n();
  const statusKey = token.graduated || token.status === 'graduated' ? 'graduated' : token.status === 'live' ? 'bonding' : 'other';
  const status = statusKey === 'graduated' ? t('graduatedStatus') : statusKey === 'bonding' ? t('bonding') : token.status;
  const variant = statusKey === 'graduated' ? 'success' : statusKey === 'bonding' ? 'info' : 'warning';

  return (
    <Link href={`/launchpad/${token.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-primary/60 to-emerald-300/60 flex items-center justify-center font-bold text-primary-foreground text-sm">
                {token.symbol.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="font-semibold truncate">{token.symbol}</span><Badge variant={variant} className="text-[10px]">{status}</Badge></div>
                <p className="text-xs text-muted-foreground line-clamp-1">{token.name}</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{token.description || t('noDescription')}</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label={t('chain')} value={token.chain} />
            <Stat label={t('supply')} value={token.total_supply} />
            <Stat label={t('age')} value={timeAgo(token.created_at)} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-mono font-medium truncate" title={value}>{value}</div></div>;
}
