'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast-provider';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/auth-provider';
import { Sparkles, AlertTriangle, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(32, 'Name too long'),
  symbol: z.string().min(2, 'Symbol must be 2-8 chars').max(8, 'Symbol must be 2-8 chars').regex(/^[A-Z0-9]+$/i, 'Letters and numbers only').transform((s) => s.toUpperCase()),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000),
  website: z.string().url().optional().or(z.literal('')),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  initialBuy: z.coerce.number().min(0).max(10000).optional().default(0),
});

type FormData = z.infer<typeof schema>;

export default function NewLaunchPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { initialBuy: 0 },
  });

  if (!user) {
    return (
      <div className="container py-20 text-center">
        <Rocket className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">{t('signInLaunch')}</h1>
        <p className="text-muted-foreground mb-6">{t('launchAuthDescription')}</p>
        <Button asChild>
          <Link href="/login?next=/launchpad/new">{t('login')}</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ symbol: string }>('/api/launchpad/tokens', data);
      toast({ variant: 'success', title: t('tokenLaunched'), description: `${data.symbol} ${t('tokenLiveDescription')}` });
      router.push(`/launchpad/${res.symbol}`);
    } catch (err) {
      const message = (err as { body?: { message?: string } })?.body?.message || t('launchFailed');
      toast({ variant: 'destructive', title: t('launchFailed'), description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container py-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> {t('launchTokenTitle')}
        </h1>
        <p className="text-muted-foreground">{t('launchTokenDescription')}</p>
      </div>

      <Card className="mb-4 border-warning/30 bg-warning/5">
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{t('beResponsible')}</p>
            <p className="text-muted-foreground text-xs">{t('riskMetadata')}</p>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('tokenDetails')}</CardTitle>
            <CardDescription>{t('tokenDetailsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="name">{t('name')}</Label>
                <Input id="name" placeholder="My Awesome Token" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="symbol">{t('symbol')}</Label>
                <Input id="symbol" placeholder="MAT" maxLength={8} {...register('symbol')} />
                {errors.symbol && <p className="text-xs text-destructive mt-1">{errors.symbol.message}</p>}
              </div>
            </div>
            <div>
              <Label htmlFor="description">{t('description')}</Label>
              <Textarea id="description" rows={4} placeholder="What does your token do?" {...register('description')} />
              {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('socialLinks')}</CardTitle>
            <CardDescription>{t('socialLinksDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="website">{t('website')}</Label>
              <Input id="website" type="url" placeholder="https://example.com" {...register('website')} />
              {errors.website && <p className="text-xs text-destructive mt-1">{errors.website.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="twitter">{t('twitter')}</Label>
                <Input id="twitter" placeholder="@yourhandle" {...register('twitter')} />
              </div>
              <div>
                <Label htmlFor="telegram">{t('telegram')}</Label>
                <Input id="telegram" placeholder="t.me/yourgroup" {...register('telegram')} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('initialBuyOptional')}</CardTitle>
            <CardDescription>{t('initialBuyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div>
              <Label htmlFor="initialBuy">{t('amountRial')}</Label>
              <Input id="initialBuy" type="number" inputMode="decimal" step="0.01" placeholder="0" {...register('initialBuy')} />
              {errors.initialBuy && <p className="text-xs text-destructive mt-1">{errors.initialBuy.message}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>{t('cancel')}</Button>
          <Button type="submit" disabled={submitting} size="lg">
            <Rocket className="mr-2 h-4 w-4" />
            {submitting ? t('deploying') : t('deployToken')}
          </Button>
        </div>
      </form>
    </div>
  );
}
