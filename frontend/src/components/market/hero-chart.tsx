'use client';

import { Activity } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';

export function HeroChart() {
  const { t } = useI18n();
  return (
    <div className="relative rounded-xl border bg-card/50 backdrop-blur p-6 shadow-xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <Activity className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t('liveTerminal')}</span>
            <Badge variant="warning" className="text-[10px]">{t('awaitingData')}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">{t('chartDescription')}</div>
        </div>
      </div>
      <div className="h-[280px] rounded-lg border border-dashed bg-muted/10 flex items-center justify-center text-center p-8">
        <p className="max-w-xs text-sm text-muted-foreground">
          No synthetic prices are shown here. Connect the market-data and matching services to enable real-time candles.
        </p>
      </div>
    </div>
  );
}
