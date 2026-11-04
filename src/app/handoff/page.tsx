// Where the phone lands after scanning the owner's QR code. The token is in the URL fragment (never sent
// to a server or written to a log); the owner opens the shop here with one tap.
import type { Metadata } from 'next';
import { OpenHere } from '@/app/_components/handoff.tsx';

export const metadata: Metadata = { title: 'Open your shop', robots: { index: false } };

export default function Handoff() {
  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s5)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>Open your shop on this phone</h1>
        <p className="soft">You scanned the code from your computer. Open the shop here to get notifications and approve with your fingerprint or face.</p>
      </div>
      <OpenHere />
    </main>
  );
}
