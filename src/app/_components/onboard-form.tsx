'use client';

// Opening a shop, one step at a time. The left column holds the one thing to do now (describe the shop,
// then make it yours); the right column shows where the owner is and, once Sayso has read the catalog,
// the draft itself, so they check what it understood without leaving the page. Photos are downscaled in
// the browser so a phone picture uploads fast and stays under the server's limit.

import { useState } from 'react';
import { MAX_ONBOARDING_PHOTOS } from '@/core/photo-limits.ts';
import { callApi } from './api.ts';
import { shrink } from './images.ts';
import { CopyField } from './client-ui.tsx';
import { Icon } from './ui.tsx';

interface Created {
  shop: { slug: string; name: string };
  products: number;
  preview: { name: string; description: string; image?: string; variants: { title: string; price: string; to_confirm: boolean; stock: string }[] }[];
  questions: string[];
  /** Only where owners sign in with a secret instead of PayPal. */
  owner_secret?: string;
  /** Where owners sign in with PayPal: this browser claims the shop there. */
  claim_url?: string;
  agent_key: string;
  review_url: string;
  mcp: { seller: string; buyer: string; this_shop: string };
  cli_login: string;
}

type Phase = 'describe' | 'reading' | 'created';

const EXAMPLE = `Hand-thrown mugs, 12 oz, $34. Sage green (6 left) and speckled white (1).
Ramen bowls $48, 3 left. Custom bud vases $62, made to order in about 10 days.
USPS in the US $8.95, free over $75. I also ship to Canada for $28.`;

export function OnboardFlow({ paypalLogin }: { paypalLogin: boolean }) {
  const [phase, setPhase] = useState<Phase>('describe');
  const [created, setCreated] = useState<Created>();

  return (
    <div className="onboard">
      <div className="onboard-main">
        {created ? (
          <MakeItYours created={created} />
        ) : (
          <Describe
            busy={phase === 'reading'}
            onSubmit={async (body) => {
              setPhase('reading');
              try {
                setCreated(await callApi<Created>('/api/shops', 'POST', body));
                setPhase('created');
              } catch (err) {
                setPhase('describe');
                throw err;
              }
            }}
          />
        )}
      </div>
      <aside className="onboard-side" aria-label="Your progress">
        <Progress phase={phase} paypalLogin={paypalLogin} />
        {phase === 'reading' && <ReadingDraft />}
        {created && <DraftPreview created={created} />}
        {phase === 'describe' && (
          <p className="small soft">
            Nothing goes live until you publish. Sayso never sets a price for you: without one, it suggests what similar items sell for, and you
            keep it or change it before anything is published. Payments run on the PayPal sandbox in this demo.
          </p>
        )}
      </aside>
    </div>
  );
}

function Describe({ busy, onSubmit }: { busy: boolean; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const [images, setImages] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>Open your shop to AI shoppers</h1>
        <p className="lede">Add photos of what you sell. Sayso names and describes each piece and suggests a price from similar items, for you to confirm.</p>
      </div>
      <form
        className="panel stack"
        style={{ gap: 'var(--s5)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setError(undefined);
          await onSubmit({
            shop_name: form.get('name') || undefined,
            text: text || undefined,
            currency: form.get('currency') || undefined,
            country: form.get('country') || undefined,
            images,
          }).catch((err: Error) => setError(err.message));
        }}
      >
        <fieldset disabled={busy} className="stack" style={{ gap: 'var(--s5)', border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="field">
            <label htmlFor="name">Shop name</label>
            <input id="name" name="name" placeholder="Maya Ceramics" maxLength={80} />
          </div>

          <div className="field">
            <span className="field-label">Photos (up to 8)</span>
            <label className="drop" htmlFor="photos" style={{ position: 'relative' }}>
              <Icon name="camera" size={22} />
              <b>{images.length ? `${images.length} photo${images.length > 1 ? 's' : ''} added` : 'Add product photos'}</b>
              <span className="small">Prices you can see in a photo count too.</span>
              <input
                id="photos"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])].slice(0, MAX_ONBOARDING_PHOTOS);
                  setImages(await Promise.all(files.map((f) => shrink(f))));
                }}
              />
            </label>
            {images.length > 0 && (
              <div className="thumbs">
                {images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`Photo ${i + 1}`} />
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <div className="spread">
              <label htmlFor="text">Anything to add (optional)</label>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setText(EXAMPLE)}>
                Use an example
              </button>
            </div>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={8000}
              placeholder="Prices if you know them, how many you have, where you ship and what it costs. A price list or an Instagram caption works too."
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input id="currency" name="currency" placeholder="USD" maxLength={3} autoCapitalize="characters" />
            </div>
            <div className="field">
              <label htmlFor="country">Ships from</label>
              <input id="country" name="country" placeholder="US" maxLength={2} autoCapitalize="characters" />
            </div>
          </div>
        </fieldset>

        <button className="btn btn-primary" disabled={busy || (!text.trim() && images.length === 0)}>
          {busy ? 'Reading your catalog...' : 'Draft my shop'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

/** After the draft: one decision (make it yours), and the agent's key that is shown only now. */
function MakeItYours({ created }: { created: Created }) {
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>{created.shop.name} is drafted</h1>
        <p className="lede">
          {created.products} product{created.products === 1 ? '' : 's'}, nothing public yet.{' '}
          {created.claim_url ? 'Make it yours, then check it and publish.' : 'Save your keys, then sign in to check it and publish.'}
        </p>
      </div>

      {created.claim_url ? (
        <section className="panel panel-raised stack claim" style={{ gap: 'var(--s4)' }} aria-labelledby="claim">
          <div className="stack" style={{ gap: 6 }}>
            <h2 id="claim">Make it yours with PayPal</h2>
            <p className="soft">
              Sign in with the PayPal account you sell with. It becomes your login, with no Sayso password to keep, and only you can approve
              what your agent asks for.
            </p>
          </div>
          <a className="btn btn-paypal btn-large" href={created.claim_url}>
            Continue with PayPal
          </a>
        </section>
      ) : (
        <section className="panel panel-hold stack" style={{ gap: 14 }} aria-labelledby="secret">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="secret">Your owner secret</h2>
            <p className="small soft">It signs you in and approves money moves. It is shown only now; keep it in a password manager.</p>
          </div>
          <CopyField value={created.owner_secret ?? ''} secret />
          <span className="small muted">
            Shop ID <span className="mono">{created.shop.slug}</span> · <a href="/owner">Sign in</a>
          </span>
        </section>
      )}

      <section className="key-note stack" aria-labelledby="agent-key">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="agent-key" className="h-small">
            <Icon name="agent" size={16} /> Your agent&apos;s key, shown once
          </h2>
          <p className="small soft">Your AI agent runs the shop with it. It can never approve anything, and you can make new ones later in Agents.</p>
        </div>
        <CopyField value={created.agent_key} secret />
        <details className="quiet-details">
          <summary className="small">Other ways to connect your agent</summary>
          <div className="field">
            <span className="field-label">As a connector in ChatGPT or any MCP client</span>
            <CopyField value={created.mcp.seller} secret />
          </div>
          <div className="field">
            <span className="field-label">From a terminal</span>
            <CopyField value={created.cli_login} secret />
          </div>
        </details>
      </section>
    </div>
  );
}

function Progress({ phase, paypalLogin }: { phase: Phase; paypalLogin: boolean }) {
  const steps = [
    { title: 'Show what you sell', note: 'Photos, and anything Sayso should know' },
    paypalLogin ? { title: 'Make it yours with PayPal', note: 'Your PayPal is your login' } : { title: 'Save your owner secret', note: 'It signs you in and approves' },
    { title: 'Check it and publish', note: 'Products are registered with PayPal' },
    { title: 'Get paid and connect your agent', note: 'Sales go straight to your PayPal' },
  ];
  const current = phase === 'created' ? 1 : 0;
  return (
    <ol className="progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : 'later';
        return (
          <li key={s.title} className={`progress-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="progress-dot" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="stack" style={{ gap: 0 }}>
              <b>{s.title}</b>
              <span className="small soft">{phase === 'reading' && i === 0 ? 'Reading your catalog...' : s.note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReadingDraft() {
  return (
    <div className="draft draft-loading" aria-live="polite">
      <span className="small soft">Drafting your catalog. This takes a few seconds.</span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="skeleton" />
      ))}
    </div>
  );
}

function DraftPreview({ created }: { created: Created }) {
  return (
    <section className="draft" aria-labelledby="draft-title">
      <div className="spread">
        <h2 id="draft-title" className="h-small">
          {created.shop.name}
        </h2>
        <span className="status status-hold">Draft</span>
      </div>
      <ul className="draft-products">
        {created.preview.map((p) => (
          <li key={p.name} className={p.image ? 'draft-product has-photo' : 'draft-product'}>
            {p.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt="" className="draft-photo" />
            )}
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <b>{p.name}</b>
              {p.description && <span className="small soft draft-description">{p.description}</span>}
              <ul>
                {p.variants.map((v) => (
                  <li key={v.title}>
                    <span>{v.title}</span>
                    <span className="small soft">{v.stock}</span>
                    <span className={`draft-price ${v.to_confirm ? 'to-confirm' : ''}`} title={v.to_confirm ? 'Suggested by Sayso: confirm it before publishing' : undefined}>
                      {v.price}
                      {v.to_confirm && <span className="small"> · to confirm</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
      {created.questions.length > 0 && (
        <div className="draft-questions">
          <b className="small">Check before you publish</b>
          <ul className="small">
            {created.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="small muted">You can change any of it in Catalog after you sign in.</p>
    </section>
  );
}
