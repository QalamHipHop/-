'use client';

'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { formatNumber, timeAgo } from '@/lib/utils';
import Link from 'next/link';
import { Shield, AlertTriangle, Activity, Users, Flag } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function AdminPage() {
  const { user, loading, hasRole } = useAuth();
  const { t } = useI18n();

  const { data: flagged, isLoading, isError: flaggedError } = useQuery({
    queryKey: ['admin-flagged'],
    queryFn: () => api.get<Array<{ id: string; symbol: string; reason: string; riskScore: number; ts: string }>>('/api/admin/flagged-tokens'),
    enabled: hasRole('admin', 'moderator'),
  });

  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const { data: stats, isError: statsError } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<{ users: number; tokens: number; volume24h: number; flagged: number }>('/api/admin/stats'),
    enabled: hasRole('admin', 'moderator'),
  });

  const { data: users, isLoading: usersLoading, isError: usersError } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<Array<{ id: string; email: string | null; username: string | null; status: string; kycLevel: number; createdAt: string }>>('/api/admin/users', { query: { limit: 100 } }),
    enabled: hasRole('admin'),
  });

  const { data: settings, isLoading: settingsLoading, isError: settingsError } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<Array<{ key: string; value: unknown; description: string | null; updatedAt: string }>>('/api/admin/settings'),
    enabled: hasRole('admin'),
  });

  async function updateUserStatus(id: string, status: 'active' | 'suspended' | 'banned') {
    try {
      await api.patch(`/api/admin/users/${id}/status`, { status, reason: `Admin status change to ${status}` });
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setNotice(`User status changed to ${status}.`);
    } catch {
      setNotice('User status update failed.');
    }
  }

  async function updateSetting(key: string, value: unknown) {
    try {
      await api.patch(`/api/admin/settings/${encodeURIComponent(key)}`, { value, reason: 'Admin platform operation' });
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setNotice('Platform setting updated.');
    } catch {
      setNotice('Platform setting update failed.');
    }
  }

  if (loading) return <div className="container py-8"><Skeleton className="h-96" /></div>;
  if (!user) {
    return (
      <div className="container py-20 text-center">
        <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold">{t('signInRequired')}</h1>
        <Button asChild className="mt-4"><Link href="/login?next=/admin">{t('login')}</Link></Button>
      </div>
    );
  }
  if (!hasRole('admin', 'moderator')) {
    return (
      <div className="container py-20 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
        <h1 className="text-2xl font-bold">{t('forbidden')}</h1>
        <p className="text-muted-foreground">{t('noAccess')}</p>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Shield className="h-7 w-7" /> Admin</h1>
        <p className="text-muted-foreground">{t('platformOperations')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Users className="h-4 w-4" />} label={t('users')} value={statsError ? 'Unavailable' : formatNumber(stats?.users || 0)} />
        <Stat icon={<Activity className="h-4 w-4" />} label={t('tokensLaunched')} value={statsError ? 'Unavailable' : formatNumber(stats?.tokens || 0)} />
        <Stat icon={<Activity className="h-4 w-4" />} label={t('volume24h')} value={statsError ? 'Unavailable' : `${formatNumber(stats?.volume24h || 0)} RIAL`} />
        <Stat icon={<Flag className="h-4 w-4" />} label={t('flagged')} value={statsError ? 'Unavailable' : formatNumber(stats?.flagged || 0)} />
      </div>

      <Tabs defaultValue="flagged">
        <TabsList>
          <TabsTrigger value="flagged">{t('flaggedTokens')}</TabsTrigger>
          <TabsTrigger value="users">{t('users')}</TabsTrigger>
          <TabsTrigger value="settings">{t('platformSettings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="flagged" className="mt-3">
          {isLoading ? <Skeleton className="h-64" /> : flaggedError ? <Unavailable label={t('moderationUnavailable')} /> : <FlaggedList items={flagged || []} />}
        </TabsContent>
        <TabsContent value="users" className="mt-3">
          {!hasRole('admin') ? <Unavailable label={t('userManagementRequired')} /> : usersLoading ? <Skeleton className="h-64" /> : usersError ? <Unavailable label={t('userDataUnavailable')} /> : <UsersList items={users || []} onStatusChange={updateUserStatus} />}
        </TabsContent>
        <TabsContent value="settings" className="mt-3">
          {!hasRole('admin') ? <Unavailable label={t('settingsRequired')} /> : settingsLoading ? <Skeleton className="h-64" /> : settingsError ? <Unavailable label={t('settingsUnavailable')} /> : <SettingsList items={settings || []} onUpdate={updateSetting} />}
        </TabsContent>
        {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
      </Tabs>
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{label}. No synthetic data is shown.</CardContent></Card>;
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

function UsersList({ items, onStatusChange }: { items: Array<{ id: string; email: string | null; username: string | null; status: string; kycLevel: number; createdAt: string }>; onStatusChange: (id: string, status: 'active' | 'suspended' | 'banned') => void }) {
  const { t } = useI18n();
  return <Card><CardContent className="p-0"><div className="divide-y">{items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><div className="font-medium">{item.username || item.email || item.id}</div><div className="text-xs text-muted-foreground">KYC {item.kycLevel} · {item.status}</div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => onStatusChange(item.id, 'active')}>{t('activate')}</Button><Button size="sm" variant="outline" onClick={() => onStatusChange(item.id, 'suspended')}>{t('suspend')}</Button><Button size="sm" variant="destructive" onClick={() => onStatusChange(item.id, 'banned')}>{t('ban')}</Button></div></div>)}</div></CardContent></Card>;
}

function SettingsList({ items, onUpdate }: { items: Array<{ key: string; value: unknown; description: string | null; updatedAt: string }>; onUpdate: (key: string, value: unknown) => void }) {
  const { t } = useI18n();
  return <Card><CardHeader><CardTitle>{t('operationalSwitches')}</CardTitle></CardHeader><CardContent className="space-y-3">{items.map((item) => { const enabled = item.value === true || item.value === 'true'; return <div key={item.key} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><div className="font-medium">{item.key}</div><div className="text-xs text-muted-foreground">{item.description || t('auditedSetting')}</div></div><Button size="sm" variant={enabled ? 'destructive' : 'outline'} onClick={() => onUpdate(item.key, !enabled)}>{enabled ? t('disable') : t('enable')}</Button></div>; })}</CardContent></Card>;
}

function FlaggedList({ items }: { items: Array<{ id: string; symbol: string; reason: string; riskScore: number; ts: string }> }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-5 px-4 py-3 text-xs text-muted-foreground border-b">
          <div>{t('symbol')}</div>
          <div>{t('reason')}</div>
          <div>{t('riskScoring')}</div>
          <div>{t('time')}</div>
          <div className="text-right">{t('review')}</div>
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
              <Button size="sm" variant="outline" className="h-7">{t('review')}</Button>
              <Button size="sm" variant="destructive" className="h-7">{t('hide')}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
