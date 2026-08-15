'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

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
  website?: string;
  telegram?: string;
  twitter?: string;
  github?: string;
  mint_authority?: string;
  freeze_authority?: string;
  status: string;
  graduated: boolean;
  created_at: string;
}

type TokenResponse = LaunchpadToken | { data?: LaunchpadToken };

function extractToken(payload: TokenResponse): LaunchpadToken | undefined {
  return 'id' in payload ? payload : payload.data;
}

export default function LaunchpadTokenPage() {
  const params = useParams<{ symbol: string }>();
  const id = params?.symbol ?? '';
  const query = useQuery({
    queryKey: ['launchpad-token', id],
    queryFn: () => api.get<TokenResponse>(`/api/launchpad/tokens/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
  const token = query.data ? extractToken(query.data) : undefined;

  if (query.isLoading) {
    return <div className="container py-8 space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-72 w-full" /></div>;
  }

  if (query.isError || !token) {
    return (
      <div className="container py-12 text-center space-y-3">
        <h1 className="text-2xl font-bold">Launchpad record unavailable</h1>
        <p className="text-muted-foreground">No fallback prices, charts, holders, or transactions are shown when the live record cannot be retrieved.</p>
        <Button asChild variant="outline"><Link href="/launchpad">Back to launchpad</Link></Button>
      </div>
    );
  }

  const status = token.graduated || token.status === 'graduated' ? 'Graduated' : token.status;
  const authorityRows = [
    ['Mint authority', token.mint_authority],
    ['Freeze authority', token.freeze_authority],
    ['Creator', token.creator_id],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <div className="container py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/launchpad"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary to-emerald-300 flex items-center justify-center text-primary-foreground font-bold">{token.symbol.slice(0, 2)}</div>
        <div className="min-w-0"><h1 className="text-2xl font-bold truncate">{token.name}</h1><p className="text-sm text-muted-foreground">{token.symbol} · created {new Date(token.created_at).toLocaleString()}</p></div>
        <div className="flex-1" /><Badge variant={status === 'Graduated' ? 'success' : status === 'live' ? 'info' : 'warning'}>{status}</Badge>
      </div>

      <Card><CardContent className="p-5 space-y-3"><h2 className="font-semibold">About</h2><p className="text-sm text-muted-foreground whitespace-pre-wrap">{token.description || 'The token creator did not publish a description.'}</p></CardContent></Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Fact label="Chain" value={token.chain} />
        <Fact label="Total supply" value={token.total_supply} />
        <Fact label="Decimals" value={String(token.decimals)} />
        <Fact label="Mint address" value={token.contract_address} mono />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-5 space-y-3"><h2 className="font-semibold">Authorities</h2>{authorityRows.length ? authorityRows.map(([label, value]) => <Fact key={label} label={label} value={value} mono />) : <p className="text-sm text-muted-foreground">No authority metadata is published for this record.</p>}</CardContent></Card>
        <Card><CardContent className="p-5 space-y-3"><h2 className="font-semibold">Official links</h2><Links token={token} /></CardContent></Card>
      </div>

      <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Market charts, order books, holders, transaction history, price, and volume are deliberately omitted until they are supplied by verified market and on-chain index data. This page never fabricates those values.</p></CardContent></Card>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className={`text-sm font-medium break-all ${mono ? 'font-mono' : ''}`}>{value}</div></div>;
}

function Links({ token }: { token: LaunchpadToken }) {
  const links = [['Website', token.website], ['Telegram', token.telegram], ['X / Twitter', token.twitter], ['GitHub', token.github]].filter((row): row is [string, string] => Boolean(row[1]));
  if (!links.length) return <p className="text-sm text-muted-foreground">No official links are published for this record.</p>;
  return <div className="space-y-2">{links.map(([label, url]) => <a key={label} className="flex items-center gap-2 text-sm text-primary hover:underline break-all" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>)}</div>;
}
