'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/components/auth/auth-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast-provider';
import { Settings, Shield, Bell, Key } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { useTheme } from 'next-themes';

interface UserSession {
  jti: string;
  userAgent?: string;
  ip?: string;
  createdAt?: string;
  lastSeen?: string;
  active?: boolean;
}

interface Preferences {
  language: string;
  theme: 'light' | 'dark' | 'system';
  fiat: string;
  notifications: { email: boolean; sms: boolean; push: boolean; telegram: boolean };
  privacy: { showPortfolio: boolean; showActivity: boolean };
}

const DEFAULT_PREFERENCES: Preferences = {
  language: 'en',
  theme: 'system',
  fiat: 'IRR',
  notifications: { email: true, sms: false, push: true, telegram: false },
  privacy: { showPortfolio: true, showActivity: true },
};

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const { setLocale, t } = useI18n();
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [mfaToken, setMfaToken] = useState('');
  const [mfaEnrollment, setMfaEnrollment] = useState<{ otpauthUrl: string; recoveryCodes: string[] } | null>(null);

  const sessions = useQuery({
    queryKey: ['user-sessions'],
    queryFn: () => api.get<UserSession[]>('/api/users/me/sessions'),
    enabled: !!user,
  });

  const sessionMutation = useMutation({
    mutationFn: (input: { jti?: string; all?: boolean }) => input.all ? api.post('/api/users/me/sessions/revoke-all') : api.delete(`/api/users/me/sessions/${input.jti}`),
    onSuccess: () => {
      toast({ title: t('preferences') });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    },
    onError: () => toast({ title: t('launchFailed'), variant: 'destructive' }),
  });

  const preferences = useQuery({
    queryKey: ['user-preferences'],
    queryFn: () => api.get<Preferences>('/api/users/me/preferences'),
    enabled: !!user,
  });
  const prefs = preferences.data ?? DEFAULT_PREFERENCES;

  useEffect(() => {
    if (user) setDisplayName(user.displayName || user.username);
  }, [user]);

  useEffect(() => {
    if (preferences.data?.language === 'fa' || preferences.data?.language === 'en') setLocale(preferences.data.language as Locale);
    if (preferences.data?.theme) setTheme(preferences.data.theme);
  }, [preferences.data?.language, preferences.data?.theme, setLocale, setTheme]);

  const profileMutation = useMutation({
    mutationFn: () => api.put('/api/users/me', { displayName: displayName.trim() }),
    onSuccess: () => {
      toast({ title: 'Profile saved' });
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: () => toast({ title: 'Profile could not be saved', variant: 'destructive' }),
  });

  const preferencesMutation = useMutation({
    mutationFn: (patch: Partial<Preferences>) => api.put<Preferences>('/api/users/me/preferences', patch),
    onSuccess: (next) => {
      queryClient.setQueryData(['user-preferences'], next);
      toast({ title: 'Preferences updated' });
    },
    onError: () => toast({ title: 'Preferences could not be updated', variant: 'destructive' }),
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.post('/api/auth/password', passwords),
    onSuccess: () => {
      setPasswords({ currentPassword: '', newPassword: '' });
      toast({ title: 'Password changed' });
    },
    onError: () => toast({ title: 'Password change failed', variant: 'destructive' }),
  });

  const mfaEnrollMutation = useMutation({
    mutationFn: () => api.post<{ otpauthUrl: string; recoveryCodes: string[] }>('/api/auth/mfa/enroll'),
    onSuccess: (data) => { setMfaEnrollment(data); toast({ title: t('mfaEnrollmentStarted') }); },
    onError: () => toast({ title: t('mfaEnrollmentFailed'), variant: 'destructive' }),
  });
  const mfaConfirmMutation = useMutation({
    mutationFn: () => api.post('/api/auth/mfa/confirm', { token: mfaToken }),
    onSuccess: () => { setMfaToken(''); setMfaEnrollment(null); toast({ title: t('mfaEnabled') }); },
    onError: () => toast({ title: t('invalidMfaCode'), variant: 'destructive' }),
  });
  const mfaRevokeMutation = useMutation({
    mutationFn: () => api.post('/api/auth/mfa/revoke'),
    onSuccess: () => { setMfaEnrollment(null); toast({ title: t('revokeMfa') }); },
    onError: () => toast({ title: t('mfaRevokeFailed'), variant: 'destructive' }),
  });

  const updateNotifications = (key: keyof Preferences['notifications'], value: boolean) => {
    preferencesMutation.mutate({ notifications: { ...prefs.notifications, [key]: value } });
  };

  if (loading) return <div className="container py-8"><Skeleton className="h-96" /></div>;
  if (!user) {
    return (
      <div className="container py-20 text-center">
        <Settings className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold">{t('signInSettings')}</h1>
        <Button asChild className="mt-4"><Link href="/login?next=/settings">{t('login')}</Link></Button>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings')}</h1>
        <p className="text-muted-foreground">Manage your account, security, language, theme, and notifications.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Key className="h-4 w-4" /> Profile</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="username">Display name</Label><Input id="username" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} /></div>
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" value={user.email} disabled /></div>
          <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending || !displayName.trim()}>{profileMutation.isPending ? 'Saving…' : 'Save profile'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div><Label htmlFor="language">Language</Label><select id="language" className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={prefs.language} onChange={(e) => { const value = e.target.value as Locale; setLocale(value); preferencesMutation.mutate({ language: value }); }}><option value="en">English</option><option value="fa">فارسی</option></select></div>
            <div><Label htmlFor="theme">Theme</Label><select id="theme" className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={prefs.theme} onChange={(e) => { const value = e.target.value as Preferences['theme']; setTheme(value); preferencesMutation.mutate({ theme: value }); }}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
            <div><Label htmlFor="fiat">Settlement currency</Label><Input id="fiat" value="IRR" disabled /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> {t('activeSessions')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">Review authenticated devices and revoke sessions you no longer trust.</p><Button variant="outline" size="sm" onClick={() => sessionMutation.mutate({ all: true })} disabled={sessionMutation.isPending}>Revoke all</Button></div>
          {sessions.isLoading ? <Skeleton className="h-20" /> : sessions.data?.length ? <div className="divide-y rounded-md border">{sessions.data.map((session) => <div key={session.jti} className="flex items-center justify-between gap-4 p-3 text-sm"><div className="min-w-0"><div className="truncate font-medium">{session.userAgent || 'Unknown device'}</div><div className="text-xs text-muted-foreground">{session.ip || 'Unknown IP'} · {session.lastSeen || session.createdAt || 'Unknown time'}</div></div><Button variant="ghost" size="sm" onClick={() => sessionMutation.mutate({ jti: session.jti })}>{t('revoke')}</Button></div>)}</div> : <p className="text-sm text-muted-foreground">{t('noActiveSessions')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> {t('security')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">{t('mfaProtection')}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => mfaEnrollMutation.mutate()} disabled={mfaEnrollMutation.isPending}>{t('setUpMfa')}</Button>
            <Button variant="ghost" onClick={() => mfaRevokeMutation.mutate()} disabled={mfaRevokeMutation.isPending}>{t('revokeMfa')}</Button>
          </div>
          {mfaEnrollment && <div className="space-y-3 rounded-lg border p-3 text-sm">
            <p className="font-medium">{t('mfaSetupInstructions')}</p>
            <code className="block break-all rounded bg-muted p-2 text-xs">{mfaEnrollment.otpauthUrl}</code>
            <p className="font-medium">Recovery codes (shown once)</p>
            <code className="block break-words rounded bg-muted p-2 text-xs">{mfaEnrollment.recoveryCodes.join(' · ')}</code>
            <div className="flex gap-2"><Input inputMode="numeric" maxLength={6} placeholder={t('sixDigitCode')} value={mfaToken} onChange={(e) => setMfaToken(e.target.value)} /><Button onClick={() => mfaConfirmMutation.mutate()} disabled={mfaConfirmMutation.isPending || !/^\\d{6}$/.test(mfaToken)}>{t('confirmMfa')}</Button></div>
          </div>}
          <div className="grid gap-2 sm:grid-cols-2"><div><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" value={passwords.currentPassword} onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))} /></div><div><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={passwords.newPassword} onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))} /></div></div>
          <Button variant="outline" onClick={() => passwordMutation.mutate()} disabled={passwordMutation.isPending || passwords.currentPassword.length < 10 || passwords.newPassword.length < 10}>{passwordMutation.isPending ? 'Changing…' : 'Change password'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <PreferenceRow label="Email notifications" desc="Receive security and account notifications by email."><Switch checked={prefs.notifications.email} onCheckedChange={(value) => updateNotifications('email', value)} /></PreferenceRow>
          <PreferenceRow label="Push notifications" desc="Receive trade and security alerts in supported clients."><Switch checked={prefs.notifications.push} onCheckedChange={(value) => updateNotifications('push', value)} /></PreferenceRow>
          <PreferenceRow label="SMS notifications" desc="SMS delivery requires a verified phone number."><Switch checked={prefs.notifications.sms} onCheckedChange={(value) => updateNotifications('sms', value)} /></PreferenceRow>
          <PreferenceRow label="Telegram notifications" desc="Telegram delivery requires a linked identity."><Switch checked={prefs.notifications.telegram} onCheckedChange={(value) => updateNotifications('telegram', value)} /></PreferenceRow>
        </CardContent>
      </Card>
    </div>
  );
}

function PreferenceRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-2 border-b last:border-0"><div><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>{children}</div>;
}
