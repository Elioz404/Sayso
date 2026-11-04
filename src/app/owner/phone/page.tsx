// Sayso on the owner's phone: install it, get notified, approve with a passkey. On a computer it shows
// a one-time QR code that opens the same shop on the phone. Also where every sign-in can be ended.
import type { Metadata } from 'next';
import { PhoneLink } from '@/app/_components/handoff.tsx';
import { SignOutEverywhere } from '@/app/_components/owner-actions.tsx';
import { PhoneSetup } from '@/app/_components/phone-setup.tsx';
import { ownerSession, SHARED_DEMO_READ_ONLY } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'On your phone' };

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined);

export default async function Phone({ searchParams }: { searchParams: Promise<{ handoff?: string }> }) {
  const [view, session] = await Promise.all([ownerView(), ownerSession()]);
  if (!view || !session) return null;
  const { shopId, demo, passkeys, push, pushKey, access } = view;
  const { handoff } = await searchParams;
  const [keys, devices] = await Promise.all([passkeys.list(shopId), push.list(shopId)]);
  const fresh = access.isFresh(session);

  return (
    <>
      <div className="view-head">
        <div>
          <h1>On your phone</h1>
          <p className="sub">Your agents work all day. Your say-so goes with you: a ping, a tap, your fingerprint.</p>
        </div>
      </div>

      {demo ? (
        <div className="empty">
          <b>Not in the shared demo shop.</b>
          <span className="small">{SHARED_DEMO_READ_ONLY}</span>
        </div>
      ) : (
        <>
          {handoff === '1' && (
            <div className="callout callout-ok">
              <span className="small">
                <b>You’re signed in on this phone.</b> Three steps and it’s set.
              </span>
            </div>
          )}
          {session.via === 'signin' && <PhoneLink fresh={fresh} hasPasskey={keys.length > 0} />}
          <PhoneSetup
            pushKey={pushKey}
            fresh={fresh}
            devices={devices.map((d) => d.label)}
            passkeys={keys.map((k) => ({ id: k.id, label: k.label, added: day(k.createdAt)!, used: day(k.lastUsedAt), synced: k.backedUp }))}
          />
          <section className="block" aria-labelledby="sessions">
            <h2 id="sessions">Lost a phone?</h2>
            <p className="small soft">Sign out of this shop on every device at once, this one included. Passkeys stay; remove a lost phone’s passkey above.</p>
            <SignOutEverywhere />
          </section>
        </>
      )}
    </>
  );
}
