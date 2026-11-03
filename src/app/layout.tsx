import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sayso',
  description: 'Sell to AI shoppers and run your shop with your own AI agent. Nothing moves without your say-so.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">
            say<span>so</span>
          </a>
          <nav>
            <a href="/start">Start selling</a>
            <a href="/shop/maya-ceramics">Demo shop</a>
            <a href="/owner">Owner</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
