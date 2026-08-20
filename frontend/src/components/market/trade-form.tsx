'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-provider';
import { api } from '@/lib/api';
import { cn, formatNumber } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface TradeFormProps {
  symbol: string;
  side: 'buy' | 'sell';
  onSideChange?: (s: 'buy' | 'sell') => void;
  marketPrice: number | null;
}

type OrderType = 'market' | 'limit';

export function TradeForm({ symbol, side, onSideChange, marketPrice }: TradeFormProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [orderType, setOrderType] = React.useState<OrderType>('limit');
  const [price, setPrice] = React.useState<string>(marketPrice && marketPrice > 0 ? marketPrice.toFixed(4) : '');
  const [amount, setAmount] = React.useState<string>('');
  const [pct, setPct] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const { data: balance, isError: balanceUnavailable } = useQuery({
    queryKey: ['balance', side === 'buy' ? 'rial' : symbol],
    queryFn: () => api.get<{ available: number; currency: string }>(`/api/wallet/balance`, { query: { asset: side === 'buy' ? 'RIAL' : symbol } }),
  });

  React.useEffect(() => {
    setPrice(marketPrice && marketPrice > 0 ? marketPrice.toFixed(marketPrice < 0.01 ? 6 : 4) : '');
  }, [marketPrice]);

  const total = (parseFloat(price || '0') * parseFloat(amount || '0')) || 0;

  const setPercent = (p: number) => {
    setPct(p);
    if (!balance) return;
    if (side === 'buy') {
      setAmount(((balance.available * p) / 100 / Math.max(0.0001, parseFloat(price || '0'))).toFixed(4));
    } else {
      setAmount(((balance.available * p) / 100).toFixed(4));
    }
  };

  const submit = async () => {
    if (!balance || balanceUnavailable) {
      toast({ variant: 'destructive', title: t('balanceUnavailable'), description: t('liveDataUnavailable') });
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast({ variant: 'destructive', title: t('invalidAmount'), description: t('positiveAmount') });
      return;
    }
    if (orderType === 'limit' && (!price || parseFloat(price) <= 0)) {
      toast({ variant: 'destructive', title: t('invalidPrice'), description: t('positivePrice') });
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/orders', {
        symbol,
        side,
        type: orderType,
        price: orderType === 'market' ? null : parseFloat(price),
        amount: parseFloat(amount),
      });
      toast({ variant: 'success', title: t('orderPlaced'), description: `${side === 'buy' ? t('buy') : t('sell')} ${amount} ${symbol}` });
      setAmount('');
      setPct(null);
    } catch (err) {
      const message = (err as { body?: { message?: string } })?.body?.message || 'Order failed';
      toast({ variant: 'destructive', title: t('orderFailed'), description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="p-0">
        <Tabs value={side} onValueChange={(v) => onSideChange?.(v as 'buy' | 'sell')}>
          <TabsList className="w-full grid grid-cols-2 rounded-none rounded-t-lg">
            <TabsTrigger
              value="buy"
              className="data-[state=active]:bg-success data-[state=active]:text-success-foreground"
            >
              {t('buy')}
            </TabsTrigger>
            <TabsTrigger
              value="sell"
              className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground"
            >
              {t('sell')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <Tabs value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="limit">{t('limit')}</TabsTrigger>
            <TabsTrigger value="market">{t('market')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {orderType === 'limit' && (
          <div className="space-y-2">
            <Label htmlFor="price">{t('price')}</Label>
            <div className="relative">
              <Input
                id="price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pr-12 font-mono"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">RIAL</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="amount">{t('amount')}</Label>
          <div className="relative">
            <Input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="pr-16 font-mono"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{symbol}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1">
          {[25, 50, 75, 100].map((p) => (
            <Button
              key={p}
              type="button"
              variant={pct === p ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPercent(p)}
            >
              {p}%
            </Button>
          ))}
        </div>

        <div className="space-y-1 text-xs">
          <Row label={t('total')} value={`${formatNumber(total, { maximumFractionDigits: 2 })} ﷼`} />
          <Row label={t('available')} value={balance ? `${formatNumber(balance.available, { maximumFractionDigits: 4 })} ${balance.currency}` : t('unavailable')} />
          <Row label={t('slippage')} value="Engine-enforced" />
          <Row label={t('fee')} value="Engine-calculated" />
        </div>

        <Button
          onClick={submit}
          disabled={submitting || !balance || balanceUnavailable}
          className={cn('w-full', side === 'buy' ? 'bg-success hover:bg-success/90' : 'bg-destructive hover:bg-destructive/90')}
        >
          {submitting ? t('submitting') : `${side === 'buy' ? t('buy') : t('sell')} ${symbol}`}
        </Button>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}
