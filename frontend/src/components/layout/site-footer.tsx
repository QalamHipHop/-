'use client';

import Link from 'next/link';

import { Github, Twitter, Send } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border/40 bg-background mt-12">
      <div className="container py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 font-bold text-lg mb-3">
              <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                ﷼
              </div>
              {t('brand')}
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              {t('footerDescription')}
            </p>
            <div className="flex gap-2 mt-4">
              <Link href="https://github.com" className="text-muted-foreground hover:text-foreground transition" aria-label="GitHub">
                <Github className="h-5 w-5" />
              </Link>
              <Link href="https://twitter.com" className="text-muted-foreground hover:text-foreground transition" aria-label="Twitter">
                <Twitter className="h-5 w-5" />
              </Link>
              <Link href="https://t.me" className="text-muted-foreground hover:text-foreground transition" aria-label="Telegram">
                <Send className="h-5 w-5" />
              </Link>
            </div>
          </div>

          <FooterColumn title={t('product')} links={[
            { href: '/trade', label: t('trade') },
            { href: '/launchpad', label: t('launchpad') },
            { href: '/portfolio', label: t('portfolio') },
            { href: '/docs', label: t('docs') },
          ]} />
          <FooterColumn title={t('developers')} links={[
            { href: '/docs/api', label: t('apiReference') },
            { href: '/docs/grpc', label: 'gRPC' },
            { href: '/docs/graphql', label: 'GraphQL' },
            { href: '/docs/websocket', label: 'WebSocket' },
          ]} />
          <FooterColumn title={t('company')} links={[
            { href: '/about', label: t('about') },
            { href: '/legal/terms', label: t('terms') },
            { href: '/legal/privacy', label: t('privacy') },
            { href: '/legal/risks', label: t('riskDisclosure') },
          ]} />
        </div>
        <div className="mt-12 pt-6 border-t flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Rial. {t('rights')}</p>
          <p>{t('riskNotice')}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h4 className="font-semibold text-sm mb-3">{title}</h4>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href as any} className="text-sm text-muted-foreground hover:text-foreground transition">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
