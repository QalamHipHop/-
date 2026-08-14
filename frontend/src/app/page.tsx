import Link from 'next/link';
import { ArrowRight, Rocket, TrendingUp, Shield, Zap, BarChart3, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TokenTicker } from '@/components/market/token-ticker';
import { TrendingTokens } from '@/components/market/trending-tokens';
import { HeroChart } from '@/components/market/hero-chart';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-0">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40 bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="container relative py-20 md:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Development environment · live data connection required
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Launch tokens. <br />
              <span className="text-primary">Trade with depth.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-prose">
              The fastest, fairest bonding-curve launchpad. Graduated tokens route to on-chain liquidity
              with real order-book execution and AI-powered risk scoring.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/launchpad">
                  <Rocket className="mr-2 h-4 w-4" /> Launch a token
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/trade">
                  Explore markets <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-6 border-t">
              <Stat label="Tokens launched" value="—" />
              <Stat label="Total volume" value="—" />
              <Stat label="Graduated" value="—" />
            </div>
          </div>
          <div className="relative">
            <HeroChart />
          </div>
        </div>
      </section>

      {/* Live ticker */}
      <TokenTicker />

      {/* Features */}
      <section className="container py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">Built for serious traders</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Connect the matching engine, settlement layer, and risk controls before presenting production metrics.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Feature
            icon={<Zap className="h-5 w-5" />}
            title="Low-latency matching"
            desc="Rust-powered order book with price-time priority. Sub-100µs round-trip."
          />
          <Feature
            icon={<TrendingUp className="h-5 w-5" />}
            title="Bonding curve launch"
            desc="Fair launch mechanics with automatic graduation to deep on-chain liquidity."
          />
          <Feature
            icon={<Shield className="h-5 w-5" />}
            title="AI risk scoring"
            desc="Every token is analyzed for rug-pull signals, holder concentration, and wash trading."
          />
          <Feature
            icon={<BarChart3 className="h-5 w-5" />}
            title="Real-time analytics"
            desc="ClickHouse-backed dashboards with OHLCV, holder stats, and on-chain flows."
          />
          <Feature
            icon={<Coins className="h-5 w-5" />}
            title="Multi-chain wallets"
            desc="Hot/cold custody with HSM-backed signing and multi-sig withdrawals."
          />
          <Feature
            icon={<Rocket className="h-5 w-5" />}
            title="One-click launch"
            desc="Metadata, social links, and initial liquidity in a single transaction."
          />
        </div>
      </section>

      {/* Trending */}
      <section className="container pb-20">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">Trending tokens</h2>
            <p className="text-muted-foreground text-sm">Most active in the last 24h</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/launchpad">
              View all <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
        <TrendingTokens />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
          {icon}
        </div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}
