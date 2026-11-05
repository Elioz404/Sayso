// One Guard record as a receipt: what was asked and by whom, what it does or did, why it waited, the
// owner's answer and PayPal's read-back. No hooks: the say-so page renders it on the server, Activity
// opens it in a modal. `children` go at the bottom (the OK / Reject buttons while it waits).

import type { ReactNode } from 'react';
import type { RecordView } from '@/core/record-view.ts';
import { OUTCOME_TONE } from '@/core/trust-report.ts';
import { When } from './time.tsx';
import { Icon } from './ui.tsx';

export function RecordReceipt({ record: v, children }: { record: RecordView; children?: ReactNode }) {
  const waiting = v.status === 'pending_approval';
  return (
    <article className="receipt" aria-label={`${v.action}${v.amount ? `, ${v.amount}` : ''}`}>
      <header className="receipt-head">
        <span className={`who ${v.byAgent ? 'who-agent' : 'who-person'}`}>
          <Icon name={v.byAgent ? 'agent' : 'person'} size={14} />
          {v.by}
        </span>
        <span className="small muted">
          <When iso={v.at} />
        </span>
      </header>

      <div className="receipt-what">
        <span className="soft">{v.action}</span>
        {v.amount && <span className={`amount${v.stopped ? ' receipt-stopped' : ''}`}>{v.amount}</span>}
        {v.counterparty && <span className="small soft">to {v.counterparty}</span>}
        {v.chainIntact ? (
          <span className={`status status-${OUTCOME_TONE[v.outcome]}`}>{v.outcome}</span>
        ) : (
          <span className="status status-stop">Edited after the fact</span>
        )}
      </div>

      <p className="reason">&ldquo;{v.reason}&rdquo;</p>

      <dl className="receipt-lines">
        {v.effects.length > 0 && (
          <>
            <dt>{waiting ? 'Would do' : v.stopped ? 'Would have done' : 'Did'}</dt>
            <dd>
              {v.effects.map((e) => (
                <span key={e}>{e}</span>
              ))}
            </dd>
          </>
        )}
        {v.hits.length > 0 && (
          <>
            <dt>{waiting ? 'Needs you' : v.status === 'denied' ? 'Blocked by' : 'Waited for you'}</dt>
            <dd className={waiting ? 'needs' : undefined}>
              {v.hits.map((h) => (
                <span key={h}>{h}</span>
              ))}
            </dd>
          </>
        )}
        {v.decided && (
          <>
            <dt>Your answer</dt>
            <dd>
              <span>
                {v.decided.approved ? 'OK' : 'No'} · <When iso={v.decided.at} />
              </span>
              {v.decided.note && <span className="soft">&ldquo;{v.decided.note}&rdquo;</span>}
              {v.signed && (
                <span className={`signed ${v.signed.ok ? 'signed-ok' : 'signed-bad'}`}>
                  <Icon name="fingerprint" size={16} />
                  {v.signed.ok ? `Signed with the passkey on ${v.signed.label}` : `The passkey signature${v.signed.label ? ` from ${v.signed.label}` : ''} does not match this request`}
                </span>
              )}
            </dd>
          </>
        )}
        {v.failure && (
          <>
            <dt>What went wrong</dt>
            <dd className="receipt-bad">{v.failure}</dd>
          </>
        )}
        <dt>PayPal</dt>
        <dd className={v.paypal === 'ok' ? 'receipt-ok' : v.paypal === 'bad' ? 'receipt-bad' : undefined}>
          {v.paypal === 'ok' && <span>✓ {v.paypalDetail}</span>}
          {v.paypal === 'bad' && !v.failure && <span>! {v.paypalDetail}</span>}
          {v.paypal === 'bad' && v.failure && <span>! Not confirmed</span>}
          {v.paypal === 'sent' && <span>Sent, waiting for the read-back</span>}
          {v.paypal === 'none' && <span className="soft">{waiting ? 'Nothing moves until you say OK' : v.stopped ? 'Nothing moved' : 'No money involved'}</span>}
        </dd>
        <dt>Record</dt>
        <dd>
          <span>
            <span className="mono">{v.id}</span> · {v.chainIntact ? <span className="receipt-ok">chain intact ✓</span> : <span className="receipt-bad">edited after the fact</span>}
          </span>
        </dd>
      </dl>
      {children}
    </article>
  );
}
