import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/toaster';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000'),
  title: { default: '﷼ Rial — Token Launch Platform', template: '%s · ﷼ Rial' },
  description:
    'Production-grade token launch & trading platform. Launch, trade, and graduate tokens with deep liquidity and on-chain transparency.',
  keywords: ['rial', 'token launch', 'bonding curve', 'DEX', 'trading', 'defi'],
  authors: [{ name: 'Qalam' }],
  openGraph: {
    type: 'website',
    title: '﷼ Rial — Token Launch Platform',
    description: 'Launch, trade, and graduate tokens with deep liquidity.',
    siteName: 'Rial',
  },
  twitter: { card: 'summary_large_image', title: '﷼ Rial' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased min-h-screen flex flex-col`}>
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
