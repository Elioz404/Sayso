import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sayso',
  description: 'Sell to AI agents, safely. Nothing moves without your say-so.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">sayso</a>
          <span className="tag">AI agents shop and sell. Nothing moves without your say-so.</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
