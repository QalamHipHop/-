import Link from 'next/link';
import { Github, Twitter, Send } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 bg-background mt-12">
      <div className="container py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 font-bold text-lg mb-3">
              <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                ﷼
              </div>
              Rial
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              Production-grade token launch & trading platform with deep liquidity and on-chain transparency.
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

          <FooterColumn title="Product" links={[
            { href: '/trade', label: 'Trade' },
            { href: '/launchpad', label: 'Launchpad' },
            { href: '/portfolio', label: 'Portfolio' },
            { href: '/docs', label: 'Docs' },
          ]} />
          <FooterColumn title="Developers" links={[
            { href: '/docs/api', label: 'API Reference' },
            { href: '/docs/grpc', label: 'gRPC' },
            { href: '/docs/graphql', label: 'GraphQL' },
            { href: '/docs/websocket', label: 'WebSocket' },
          ]} />
          <FooterColumn title="Company" links={[
            { href: '/about', label: 'About' },
            { href: '/legal/terms', label: 'Terms' },
            { href: '/legal/privacy', label: 'Privacy' },
            { href: '/legal/risks', label: 'Risk Disclosure' },
          ]} />
        </div>
        <div className="mt-12 pt-6 border-t flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Rial. All rights reserved.</p>
          <p>Trading digital assets carries risk. Past performance ≠ future results.</p>
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
