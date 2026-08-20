'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/auth-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

type Chain = 'iban';
interface WithdrawalDestination { id: string; chain: Chain; destination: string; label?: string; status: 'pending' | 'active' | 'revoked' | string; cooldown_until?: string; }
interface DestinationResponse { items?: WithdrawalDestination[]; data?: { items?: WithdrawalDestination[] } }

export default function FundingPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [chain, setChain] = useState<Chain>('iban');
  const [message, setMessage] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [confirmTokens, setConfirmTokens] = useState<Record<string, string>>({});

  const destinations = useQuery({
    queryKey: ['withdrawal-destinations'],
    queryFn: () => api.get<DestinationResponse>('/api/wallet/withdrawal-destinations'),
    enabled: !!user,
  });

  const deposit = useMutation({
    mutationFn: () => api.post('/api/wallet/deposit', { adapter: 'zarinpal', currency: 'IRR', amountMinor: depositAmount, reference: `web-${Date.now()}`, idempotencyKey: `deposit-${crypto.randomUUID()}` }),
    onSuccess: () => setMessage(t('depositCreated')),
    onError: () => setMessage(t('depositUnavailable')),
  });
  const withdraw = useMutation({
    mutationFn: () => api.post('/api/wallet/withdraw', { currency: 'RIAL', chain, amount: withdrawAmount, destination, clientId: `web-${crypto.randomUUID()}` }),
    onSuccess: () => setMessage(t('withdrawSubmitted')),
    onError: () => setMessage(t('withdrawFailed')),
  });
  const addDestination = useMutation({
    mutationFn: () => api.post<{ destination?: WithdrawalDestination; confirmation_token?: string }>('/api/wallet/withdrawal-destinations', { chain, destination, label: label || undefined }),
    onSuccess: (result) => { setMessage(t('destinationCreated')); setDestination(''); setLabel(''); void queryClient.invalidateQueries({ queryKey: ['withdrawal-destinations'] }); if (result.confirmation_token && result.destination?.id) setConfirmTokens((current) => ({ ...current, [result.destination!.id]: result.confirmation_token! })); },
    onError: () => setMessage(t('destinationActionFailed')),
  });
  const confirmDestination = useMutation({
    mutationFn: (id: string) => api.post(`/api/wallet/withdrawal-destinations/${id}/confirm`, { token: confirmTokens[id] }),
    onSuccess: () => { setMessage(t('destinationConfirmed')); void queryClient.invalidateQueries({ queryKey: ['withdrawal-destinations'] }); },
    onError: () => setMessage(t('destinationActionFailed')),
  });
  const revokeDestination = useMutation({
    mutationFn: (id: string) => api.post(`/api/wallet/withdrawal-destinations/${id}/revoke`),
    onSuccess: () => { setMessage(t('destinationRevoked')); void queryClient.invalidateQueries({ queryKey: ['withdrawal-destinations'] }); },
    onError: () => setMessage(t('destinationActionFailed')),
  });

  if (loading) return <div className="container py-12">{t('loading')}</div>;
  if (!user) return <div className="container py-16 text-center"><p className="mb-4">{t('signInFunding')}</p><Button asChild><Link href="/login?next=/portfolio/funding">{t('login')}</Link></Button></div>;
  const items = destinations.data?.items ?? destinations.data?.data?.items ?? [];

  return <div className="container max-w-5xl py-8 space-y-6">
    <Button asChild variant="ghost"><Link href="/portfolio"><ArrowLeft className="mr-2 h-4 w-4" />{t('backToPortfolio')}</Link></Button>
    <div><h1 className="text-3xl font-bold">{t('fundWallet')}</h1><p className="text-muted-foreground">All requests are recorded in the authoritative wallet ledger and are never credited from the browser.</p></div>
    <div className="grid gap-5 md:grid-cols-2">
      <Card><CardHeader><CardTitle><ArrowDownToLine className="mr-2 inline h-5 w-5" />{t('deposit')}</CardTitle><CardDescription>{t('depositDescription')}</CardDescription></CardHeader><CardContent className="space-y-3"><label className="text-sm">{t('amountMinorRial')}<Input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="numeric" placeholder="1000000" /></label><Button className="w-full" disabled={!depositAmount || deposit.isPending} onClick={() => deposit.mutate()}>{deposit.isPending ? t('loading') : t('createDeposit')}</Button></CardContent></Card>
      <Card><CardHeader><CardTitle><ArrowUpFromLine className="mr-2 inline h-5 w-5" />{t('withdraw')}</CardTitle><CardDescription>{t('withdrawDescription')}</CardDescription></CardHeader><CardContent className="space-y-3"><label className="text-sm">{t('amountMinorRial')}<Input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} inputMode="numeric" placeholder="1000000" /></label><label className="text-sm">{t('network')}<select aria-label={t('network')} className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={chain} onChange={(e) => setChain(e.target.value as Chain)}><option value="iban">IBAN / bank</option></select></label><label className="text-sm">{t('destination')}<Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="chain:address or approved bank reference" /></label><Button className="w-full" disabled={!withdrawAmount || !destination || withdraw.isPending} onClick={() => withdraw.mutate()}>{withdraw.isPending ? t('loading') : t('requestWithdrawal')}</Button></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>{t('whitelist')}</CardTitle><CardDescription>{t('whitelistDescription')}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><select className="h-10 rounded-md border bg-background px-3 text-sm" value={chain} onChange={(e) => setChain(e.target.value as Chain)}><option value="iban">IBAN / bank</option></select><Input className="md:col-span-2" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={t('destination')} /><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelOptional')} /><Button disabled={!destination || addDestination.isPending} onClick={() => addDestination.mutate()}>{t('addDestination')}</Button></div><div className="space-y-2">{destinations.isLoading ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">{t('noDestinations')}</p> : items.map((item) => <div key={item.id} className="rounded-lg border p-3 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{item.label || item.destination}</div><div className="text-xs text-muted-foreground">{item.chain} · {item.destination}</div></div><span className="text-xs rounded-full border px-2 py-1">{item.status === 'pending' ? t('pendingConfirmation') : item.status === 'active' ? t('activeDestination') : t('revokedDestination')}</span></div>{item.cooldown_until && <div className="text-xs text-muted-foreground">{t('cooldownUntil')}: {new Date(item.cooldown_until).toLocaleString()}</div>}<div className="flex flex-wrap gap-2">{item.status === 'pending' && <><Input className="max-w-xs" value={confirmTokens[item.id] || ''} onChange={(e) => setConfirmTokens((current) => ({ ...current, [item.id]: e.target.value }))} placeholder={t('confirmationToken')} /><Button size="sm" disabled={!confirmTokens[item.id] || confirmDestination.isPending} onClick={() => confirmDestination.mutate(item.id)}>{t('confirmDestination')}</Button></>}{item.status !== 'revoked' && <Button size="sm" variant="destructive" disabled={revokeDestination.isPending} onClick={() => revokeDestination.mutate(item.id)}>{t('revokeDestination')}</Button>}</div></div>)}</div></CardContent></Card>
    <div className="flex items-start gap-3 rounded-lg border p-4 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" /><p>{t('securityNotice')}</p></div>
    {message && <Card><CardContent className="p-4 text-sm">{message}</CardContent></Card>}
  </div>;
}
