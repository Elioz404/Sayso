import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from 'next/font/google';
import { NavLinks } from '@/app/_components/client-ui.tsx';
import { Mark } from '@/app/_components/ui.tsx';
import { ownerShopId } from '@/server/http.ts';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-bricolage', display: 'swap' });
const body = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-figtree', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Sayso', template: '%s · Sayso' },
  description: 'Sell to AI shoppers and run your shop with your own AI agent. Nothing moves without your say-so.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#151c19' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = Boolean(await ownerShopId().catch(() => undefined));
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="site-header">
          <div className="wrap">
            <a href="/" className="brand" aria-label="Sayso home">
              <Mark />
              <span className="brand-word">sayso</span>
            </a>
            <NavLinks signedIn={signedIn} />
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="wrap">
            <span>Sayso · PayPal sandbox demo</span>
            <span>Payments by PayPal. Nothing moves without the owner&apos;s say-so.</span>
            <a href="/api/health">Status</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
