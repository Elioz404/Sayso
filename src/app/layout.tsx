import { DOCK_RESTORE_SCRIPT } from '@/app/_components/dock-restore.ts';
import { ShopperDock } from '@/app/_components/shopper-dock.tsx';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NavLinks, ServiceWorker } from '@/app/_components/client-ui.tsx';
import { Mark } from '@/app/_components/ui.tsx';
import { ABOUT } from '@/core/about.ts';
import './globals.css';

// Self-hosted from the Fontsource packages (Latin only), not fetched from Google at build time: the
// server and browser builds each fetched the CSS on their own, and when Google answered differently the
// page's font class no longer matched the stylesheet and text fell back to the browser default.
const bricolage = localFont({
  src: '../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
  weight: '200 800',
  variable: '--font-bricolage',
  display: 'swap',
});
const figtree = localFont({
  src: '../../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2',
  weight: '300 900',
  variable: '--font-figtree',
  display: 'swap',
});
const plexMono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

const DESCRIPTION = 'Sell to AI shoppers and run your shop with your own AI agent. Nothing moves without your say-so.';

export const metadata: Metadata = {
  // Share cards and canonical links point at this deployment's public address.
  metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'),
  title: { default: 'Sayso', template: '%s · Sayso' },
  description: DESCRIPTION,
  openGraph: { siteName: 'Sayso', title: 'Sayso', description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Sayso', description: DESCRIPTION },
  // Added to the home screen, Sayso opens full screen like an app (and can get notifications on iPhone).
  appleWebApp: { capable: true, title: 'Sayso', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fffdfa' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1714' },
  ],
};

// No cookies or database here, so pages that don't need them can be rendered ahead of time.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the head script may mark the panel open before React starts.
    <html lang="en" className={`${bricolage.variable} ${figtree.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DOCK_RESTORE_SCRIPT }} />
      </head>
      <body>
        <ServiceWorker />
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
        <ShopperDock paypalClientId={process.env.PAYPAL_CLIENT_ID || undefined} />
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
              <a href="/shops">Shops</a>
              <a href="/assistant">Shop with AI</a>
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
