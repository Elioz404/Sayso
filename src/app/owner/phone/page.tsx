// Sayso on the owner's phone: install it, get notified, approve with a passkey. On a computer it shows
// a QR code that signs the phone in to the same shop for ten minutes.
import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { PhoneSetup } from '@/app/_components/phone.tsx';
import { HANDOFF_PURPOSE } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'On your phone' };

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined);

export default async function Phone({ searchParams }: { searchParams: Promise<{ handoff?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { shopId, demo, passkeys, push, access, links, pushKey } = view;
  const { handoff } = await searchParams;
  const [keys, devices] = await Promise.all([passkeys.list(shopId), push.list(shopId)]);

  const link = demo ? undefined : `${links.base}/handoff/${encodeURIComponent(access.signValue(HANDOFF_PURPOSE, shopId, 10 * 60_000))}`;
  const qr = link && (await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221c17', light: '#00000000' } }));

  return (
    <>
      <div className="view-head">
        <div>
          <h1>On your phone</h1>
          <p className="sub">Your agents work all day. Your say-so goes with you: a ping, a tap, your fingerprint.</p>
        </div>
      </div>

      {handoff === '1' && (
        <div className="callout callout-ok">
          <span className="small">
            <b>You’re signed in on this phone.</b> Three steps and it’s set.
          </span>
        </div>
      )}
      {handoff === 'expired' && (
        <div className="callout">
          <span className="small">That QR code expired. Scan a fresh one from your computer.</span>
        </div>
      )}

      {qr && (
        <section className="handoff" aria-labelledby="handoff">
          <div className="handoff-qr" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="QR code that opens your shop on your phone" />
          <div className="stack" style={{ gap: 8 }}>
            <h2 id="handoff">On your computer? Scan this with your phone</h2>
            <p className="soft">It opens this shop on your phone, already signed in, so you can set it up there. The code works for ten minutes.</p>
          </div>
        </section>
      )}

      <PhoneSetup
        pushKey={pushKey}
        shared={demo}
        devices={devices.map((d) => d.label)}
        passkeys={keys.map((k) => ({ id: k.id, label: k.label, added: day(k.createdAt)!, used: day(k.lastUsedAt), synced: k.backedUp }))}
      />
    </>
  );
}
