'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/components/ui/toast-provider';
import { LogIn } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  mfaCode: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = params.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/portfolio';
  const { login } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      await login(data.email, data.password, data.mfaCode);
      toast({ variant: 'success', title: t('welcomeBack') });
      router.push(next as never);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 && !needsMfa) {
        setNeedsMfa(true);
        toast({ title: t('mfaRequired'), description: recoveryMode ? t('recoveryCodeHint') : t('enterSixDigit') });
      } else {
        toast({ variant: 'destructive', title: t('loginFailed'), description: t('invalidCredentials') });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-md py-20">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <LogIn className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t('welcomeBack')}</CardTitle>
          <CardDescription>{t('loginDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            {needsMfa && (
              <div>
                <Label htmlFor="mfaCode">{recoveryMode ? t('mfaRecoveryCode') : t('mfaCode')}</Label>
                <Input id="mfaCode" inputMode={recoveryMode ? 'text' : 'numeric'} maxLength={recoveryMode ? 16 : 6} placeholder={recoveryMode ? 'A1B2C3D4E5F60718' : '123456'} {...register('mfaCode')} />
                <p className="mt-1 text-xs text-muted-foreground">{recoveryMode ? t('recoveryCodeHint') : t('enterSixDigit')}</p>
                <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setRecoveryMode((current) => !current)}>{recoveryMode ? t('useTotpCode') : t('useRecoveryCode')}</button>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('signingIn') : t('login')}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            {t('noAccount')}{' '}
            <Link href="/register" className="text-primary hover:underline">{t('signup')}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
