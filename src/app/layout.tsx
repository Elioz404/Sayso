import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from 'next/font/google';
import { NavLinks } from '@/app/_components/client-ui.tsx';
import { Mark } from '@/app/_components/ui.tsx';
import { ABOUT } from '@/core/about.ts';
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

// No cookies or database here, so pages that don't need them can be rendered ahead of time.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="site-header">
          <div className="wrap">
            <a href="/" className="brand" aria-label="Sayso home">
              <Mark />
              <span className="brand-word">sayso</span>
            </a>
            <NavLinks />
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="wrap footer-grid">
            <div className="footer-about">
              <a href="/" className="brand" aria-label="Sayso home">
                <Mark size={24} />
                <span className="brand-word">sayso</span>
              </a>
              <p>Small shops for AI shoppers, run by their owners&apos; own agents. Nothing moves without your say-so.</p>
              <p className="muted">A demo on the PayPal sandbox. No real money moves.</p>
            </div>
            <nav aria-label="Product" className="footer-links">
              <b>Product</b>
              <a href="/start">Start selling</a>
              <a href={`/shop/${ABOUT.demoShop}`}>Demo shop</a>
              <a href="/owner">Owner sign-in</a>
              <a href="/docs">Docs</a>
            </nav>
            <nav aria-label="Project" className="footer-links">
              <b>Project</b>
              <a href={ABOUT.repository}>Source on GitHub</a>
              <a href={`${ABOUT.repository}/blob/main/LICENSE`}>MIT license</a>
              <a href="/api/health">Status</a>
            </nav>
          </div>
          <div className="wrap footer-base">
            <span>Built for the PayPal AI Hackathon, 2026.</span>
            <span>Payments by PayPal.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
