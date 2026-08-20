'use client';

import Link from 'next/link';
import { ArrowRight, Rocket, TrendingUp, Shield, Zap, BarChart3, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TokenTicker } from '@/components/market/token-ticker';
import { TrendingTokens } from '@/components/market/trending-tokens';
import { HeroChart } from '@/components/market/hero-chart';
import { useI18n } from '@/lib/i18n';

export default function HomePage() {
  const { t } = useI18n();
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
              {t('developmentDataRequired')}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              {t('heroLaunch')} <br />
              <span className="text-primary">{t('heroTrade')}</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-prose">
              {t('heroDescription')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/launchpad">
                  <Rocket className="mr-2 h-4 w-4" /> {t('launchToken')}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/trade">
                  {t('exploreMarkets')} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 pt-6 border-t">
              <Stat label={t('tokensLaunched')} value="—" />
              <Stat label={t('totalVolume')} value="—" />
              <Stat label={t('graduated')} value="—" />
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
          <h2 className="text-3xl md:text-4xl font-bold mb-3">{t('seriousTraders')}</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">{t('seriousDescription')}</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Feature
            icon={<Zap className="h-5 w-5" />}
            title={t('lowLatency')}
            desc={t('lowLatencyDescription')}
          />
          <Feature
            icon={<TrendingUp className="h-5 w-5" />}
            title={t('bondingCurve')}
            desc={t('bondingCurveDescription')}
          />
          <Feature
            icon={<Shield className="h-5 w-5" />}
            title={t('riskScoring')}
            desc={t('riskScoringDescription')}
          />
          <Feature
            icon={<BarChart3 className="h-5 w-5" />}
            title={t('analytics')}
            desc={t('analyticsDescription')}
          />
          <Feature
            icon={<Coins className="h-5 w-5" />}
            title={t('custodyWallets')}
            desc={t('custodyWalletsDescription')}
          />
          <Feature
            icon={<Rocket className="h-5 w-5" />}
            title={t('oneClickLaunch')}
            desc={t('oneClickLaunchDescription')}
          />
        </div>
      </section>

      {/* Trending */}
      <section className="container pb-20">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">{t('trendingTokens')}</h2>
            <p className="text-muted-foreground text-sm">{t('activeLast24h')}</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/launchpad">
              {t('viewAll')} <ArrowRight className="ml-1 h-3 w-3" />
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
