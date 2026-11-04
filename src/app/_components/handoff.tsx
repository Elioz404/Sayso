'use client';

// "Continue on your phone", both ends: the code on the device the owner signed in on, and the button
// on the phone that scanned it.

import { useEffect, useState } from 'react';
import { callApi } from './api.ts';
import { signChallenge, usePasskeyChallenge } from './passkey-client.ts';
import { useAction } from './use-action.ts';
import { Icon } from './ui.tsx';

/** The QR code: shown at once right after signing in, otherwise after a passkey confirmation. */
export function PhoneLink({ fresh, hasPasskey }: { fresh: boolean; hasPasskey: boolean }) {
  const [link, setLink] = useState<{ url: string; qr: string }>();
  const { busy, error, run } = useAction();
  const confirm = usePasskeyChallenge(!fresh && hasPasskey ? { purpose: 'confirm', what: 'phone-link' } : undefined);

  useEffect(() => {
    if (fresh) void run(async () => setLink(await callApi('/api/owner/handoff', 'POST')));
  }, [fresh, run]);

  const show = () =>
    run(async () => {
      if (!confirm.challenge) throw new Error(confirm.error ?? 'Getting ready, try again in a second');
      const proof = await signChallenge(confirm.challenge);
      setLink(await callApi('/api/owner/handoff', 'POST', { proof }));
    });

  return (
    <section className="handoff" aria-labelledby="handoff">
      {link ? (
        <div className="handoff-qr" dangerouslySetInnerHTML={{ __html: link.qr }} role="img" aria-label="QR code that opens your shop on your phone" />
      ) : (
        <div className="handoff-qr handoff-qr-empty" aria-hidden="true">
          <Icon name="qr" size={40} />
        </div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <h2 id="handoff">On your computer? Scan this with your phone</h2>
        <p className="soft">It opens this shop on your phone, so you can set it up there. The code works once, for five minutes.</p>
        {!link && !fresh && hasPasskey && (
          <button className="btn" disabled={Boolean(busy)} onClick={() => void show()}>
            <Icon name="fingerprint" size={18} /> {busy ? 'Waiting for your passkey...' : 'Show the code'}
          </button>
        )}
        {!link && !fresh && !hasPasskey && <p className="small soft">For your safety, the code shows for 30 minutes after you sign in. Sign out and in again to see it.</p>}
        {error && <p className="error small">{error}</p>}
      </div>
    </section>
  );
}

/** On the phone: one tap opens the shop with the token from the URL fragment. */
export function OpenHere() {
  const [token, setToken] = useState<string | null>();
  const { busy, error, run } = useAction();
  useEffect(() => setToken(window.location.hash.slice(1) || null), []);

  if (token === undefined) return null;
  if (!token) return <p className="soft">This page needs the code from your computer. Open Sayso there, go to On your phone, and scan the code.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <button
        className="btn btn-primary btn-big"
        disabled={Boolean(busy)}
        onClick={() =>
          void run(async () => {
            await callApi('/api/owner/handoff/redeem', 'POST', { token });
            history.replaceState(null, '', '/handoff'); // the token is spent; keep it out of history
            window.location.assign('/owner/phone?handoff=1');
          })
        }
      >
        {busy ? 'Opening...' : 'Open my shop here'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
