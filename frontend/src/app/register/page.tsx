'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { UserPlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const schema = z.object({
  email: z.string().email('Invalid email'),
  username: z.string().min(3, 'Username must be 3-20 chars').max(20).regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, underscore only'),
  password: z.string().min(8, 'Password must be at least 8 characters').regex(/[A-Z]/, 'Must contain an uppercase letter').regex(/[0-9]/, 'Must contain a number'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: doRegister } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      await doRegister(data.email, data.password, data.username);
      toast({ variant: 'success', title: t('welcomeRial') });
      router.push('/portfolio');
    } catch {
      toast({ variant: 'destructive', title: t('signupFailed'), description: t('accountTaken') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-md py-20">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t('createAccount')}</CardTitle>
          <CardDescription>{t('registerDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="username">{t('username')}</Label>
              <Input id="username" autoComplete="username" {...register('username')} />
              {errors.username && <p className="text-xs text-destructive mt-1">{errors.username.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            <div>
              <Label htmlFor="confirm">{t('confirmPassword')}</Label>
              <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
              {errors.confirm && <p className="text-xs text-destructive mt-1">{errors.confirm.message}</p>}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('agreeTerms')} <Link href={"/legal/terms" as any} className="underline">{t('terms')}</Link> {t('ackRisk')} <Link href={"/legal/risks" as any} className="underline">{t('riskDisclosure')}</Link>.
            </p>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('creatingAccount') : t('createAccount')}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            {t('alreadyAccount')}{' '}
            <Link href="/login" className="text-primary hover:underline">{t('login')}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
