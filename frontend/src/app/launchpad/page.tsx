'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Flame, Search, Sparkles, Clock, TrendingUp } from 'lucide-react';
import { formatNumber, formatPercent, timeAgo } from '@/lib/utils';

interface LaunchpadToken {
  id: string;
  symbol: string;
  name: string;
  description: string;
  logoUrl?: string;
  marketCap: number;
  volume24h: number;
  change24h: number;
  bondingProgress: number;
  raised: number;
  target: number;
  createdAt: string;
  graduated: boolean;
  riskScore?: number;
  creator: string;
}

const SAMPLE: LaunchpadToken[] = [
  { id: '1', symbol: 'AURORA', name: 'Aurora AI', description: 'Decentralized AI compute network.', marketCap: 2_400_000, volume24h: 412_000, change24h: 18.4, bondingProgress: 78, raised: 78000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), graduated: false, riskScore: 22, creator: '0x1234' },
  { id: '2', symbol: 'GALAXY', name: 'Galactic Memes', description: 'The funniest space memes.', marketCap: 890_000, volume24h: 89_432, change24h: -3.2, bondingProgress: 41, raised: 41000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 1).toISOString(), graduated: false, riskScore: 28, creator: '0x5678' },
  { id: '3', symbol: 'MOON', name: 'MoonShot', description: 'To the moon!', marketCap: 12_400_000, volume24h: 1_456_789, change24h: 28.9, bondingProgress: 100, raised: 100000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 12).toISOString(), graduated: true, riskScore: 8, creator: '0x9abc' },
  { id: '4', symbol: 'NEON', name: 'Neon Pulse', description: 'Retro cyberpunk vibe.', marketCap: 18_700_000, volume24h: 543_210, change24h: 5.6, bondingProgress: 100, raised: 100000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 25).toISOString(), graduated: true, riskScore: 5, creator: '0xdef0' },
  { id: '5', symbol: 'QALAM', name: 'Qalam', description: 'A writing token for creators.', marketCap: 998_000, volume24h: 12_000, change24h: 0.4, bondingProgress: 64, raised: 64000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 4).toISOString(), graduated: false, riskScore: 15, creator: '0x1111' },
  { id: '6', symbol: 'BOLT', name: 'Lightning', description: 'Instant payments on-chain.', marketCap: 5_670_000, volume24h: 198_765, change24h: 15.7, bondingProgress: 100, raised: 100000, target: 100000, createdAt: new Date(Date.now() - 86400000 * 8).toISOString(), graduated: true, riskScore: 18, creator: '0x2222' },
];

export default function LaunchpadPage() {
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');

  const filtered = SAMPLE.filter((t) => {
    if (q && !`${t.symbol} ${t.name}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'graduated') return t.graduated;
    if (tab === 'live') return !t.graduated;
    return true;
  }).sort((a, b) => {
    if (tab === 'trending') return b.volume24h - a.volume24h;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="container py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Flame className="h-7 w-7 text-orange-500" /> Launchpad
          </h1>
          <p className="text-muted-foreground">Discover and trade freshly-launched tokens with bonding-curve liquidity.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/launchpad/new"><Sparkles className="mr-2 h-4 w-4" /> Launch a token</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or symbol…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="new"><Clock className="mr-1 h-3.5 w-3.5" /> New</TabsTrigger>
              <TabsTrigger value="trending"><TrendingUp className="mr-1 h-3.5 w-3.5" /> Trending</TabsTrigger>
              <TabsTrigger value="live">Live</TabsTrigger>
              <TabsTrigger value="graduated">Graduated</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsContent value={tab} className="mt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((t) => (
              <TokenCard key={t.id} t={t} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">No tokens match your search.</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TokenCard({ t }: { t: LaunchpadToken }) {
  return (
    <Link href={`/launchpad/${t.symbol}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/60 to-emerald-300/60 flex items-center justify-center font-bold text-primary-foreground text-sm">
                {t.symbol.slice(0, 2)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t.symbol}</span>
                  {t.graduated ? <Badge variant="success" className="text-[10px]">Graduated</Badge> : <Badge variant="info" className="text-[10px]">Bonding</Badge>}
                  {t.riskScore !== undefined && (
                    <Badge
                      variant={t.riskScore < 20 ? 'success' : t.riskScore < 50 ? 'warning' : 'destructive'}
                      className="text-[10px]"
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
          <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Bonding curve</span>
              <span>{t.bondingProgress.toFixed(0)}%</span>
            </div>
            <Progress value={t.bondingProgress} className="h-1.5" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="MCap" value={`$${formatNumber(t.marketCap)}`} />
            <Stat label="Vol 24h" value={`$${formatNumber(t.volume24h)}`} />
            <Stat label="Age" value={timeAgo(t.createdAt)} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
