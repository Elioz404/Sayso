'use client';

// The owner's answer to an AI app asking to run their shop. Sent with fetch (the site's CSP keeps form
// posts on this origin), then the page goes where the server says: back to the app with a code, or with
// access_denied. Allowing is confirmed with the passkey once the shop has one.

import { useAction } from './use-action.ts';
import { callApi } from './api.ts';
import { signChallenge, usePasskeyChallenge } from './passkey-client.ts';

export function ConsentAnswer({ request, passkey }: { request: string; passkey: boolean }) {
  const { busy, error, run } = useAction();
  const confirm = usePasskeyChallenge(passkey ? { purpose: 'confirm', what: 'agent-key' } : undefined);
  const answer = (decision: 'allow' | 'deny') =>
    run(async () => {
      let proof;
      if (decision === 'allow' && passkey) {
        if (!confirm.challenge) throw new Error(confirm.error ?? 'Getting the passkey ready, try again in a second');
        proof = await signChallenge(confirm.challenge);
      }
      const { location } = await callApi<{ location: string }>('/api/oauth/consent', 'POST', { request, decision, proof });
      window.location.assign(location);
    }, decision);

  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <div className="connect-actions">
        <button type="button" className="btn btn-quiet" disabled={Boolean(busy)} onClick={() => void answer('deny')}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void answer('allow')}>
          {busy === 'allow' ? (passkey ? 'Waiting for your passkey…' : 'Allowing…') : 'Allow'}
        </button>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
