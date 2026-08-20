'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Rocket, TrendingUp, Wallet, Shield, LogOut, User, Settings, Languages, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const NAV = [
  { href: '/trade', key: 'trade' as const, icon: TrendingUp },
  { href: '/launchpad', key: 'launchpad' as const, icon: Rocket },
  { href: '/portfolio', key: 'portfolio' as const, icon: Wallet, auth: true },
  { href: '/admin', key: 'admin' as const, icon: Shield, auth: true, roles: ['admin', 'moderator'] as const },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user, logout, hasRole, loading } = useAuth();
  const { locale, setLocale, t } = useI18n();

  return (
    <header className="glass sticky top-0 z-50 w-full border-x-0 border-t-0">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="glass-strong h-7 w-7 rounded-md bg-primary/90 flex items-center justify-center text-primary-foreground">
            ﷼
          </div>
          <span>Rial</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.filter((item) => !item.auth || user).map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href as any}
                className={cn(
                  'glass-interactive inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  active ? 'glass-strong text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                  <Icon className="h-4 w-4" /> {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="glass-interactive h-9 w-9" aria-label="Navigation menu">
                <Menu className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {NAV.filter((item) => !item.auth || user).map((item) => {
                const Icon = item.icon;
                return <DropdownMenuItem key={item.href} asChild><Link href={item.href as any}><Icon className="mr-2 h-4 w-4" />{t(item.key)}</Link></DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="glass-interactive h-9 w-9" onClick={() => setLocale(locale === 'fa' ? 'en' : 'fa')} aria-label={t('language')} title={locale === 'fa' ? t('english') : t('persian')}><Languages className="h-4 w-4" /></Button>
          <ThemeToggle />
          {loading ? (
            <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar>
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.username} />}
                    <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user.displayName || user.username}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/portfolio"><User className="mr-2 h-4 w-4" /> {t('portfolio')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings"><Settings className="mr-2 h-4 w-4" /> {t('settings')}</Link>
                </DropdownMenuItem>
                {hasRole('admin', 'moderator') && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin"><Shield className="mr-2 h-4 w-4" /> {t('admin')}</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" /> {t('logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">{t('login')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">{t('signup')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
