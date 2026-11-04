'use client';

// Opening a shop on one page, in three steps. Upload: photos of the pieces (dropped or picked, shrunk in
// the browser so a phone picture uploads fast), the shop's name and, if they like, notes. Review: the AI's
// draft as editable cards (names, descriptions, prices, stock, shipping); a price Sayso suggested only
// counts once the owner keeps it or types their own. Publish: signing in with PayPal claims the shop and
// publishes it in one go.

import { useState } from 'react';
import type { DraftView } from '@/core/catalog-view.ts';
import { MAX_ONBOARDING_PHOTOS } from '@/core/photo-limits.ts';
import { callApi } from './api.ts';
import { CopyField } from './client-ui.tsx';
import { shrink } from './images.ts';
import { Icon } from './ui.tsx';

interface Created {
  shop: { slug: string; name: string };
  draft: DraftView;
  /** Only where owners sign in with a secret instead of PayPal. */
  owner_secret?: string;
}

const EXAMPLE = `Hand-thrown mugs, 12 oz, $34. Sage green (6 left) and speckled white (1).
Ramen bowls $48, 3 left. Custom bud vases $62, made to order in about 10 days.
USPS in the US $8.95, free over $75.`;

export function OnboardFlow({ paypalLogin }: { paypalLogin: boolean }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [created, setCreated] = useState<Created>();
  const [drafting, setDrafting] = useState(false);
  const step = created ? 2 : 1;

  return (
    <div className="sell">
      <header className="sell-head">
        <h1>Open your shop</h1>
        <p className="lede">Photos in, a shop AI shoppers can buy from out. You check everything before it goes live.</p>
      </header>
      <Steps step={step} drafting={drafting} paypalLogin={paypalLogin} />
      {created ? (
        <Review created={created} paypalLogin={paypalLogin} onStartOver={() => setCreated(undefined)} />
      ) : drafting ? (
        <Drafting photos={photos} />
      ) : (
        <Upload
          photos={photos}
          setPhotos={setPhotos}
          onDraft={async (body) => {
            setDrafting(true);
            try {
              setCreated(await callApi<Created>('/api/shops', 'POST', { ...body, images: photos, agent_key: false }));
            } finally {
              setDrafting(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Steps({ step, drafting, paypalLogin }: { step: 1 | 2; drafting: boolean; paypalLogin: boolean }) {
  const steps = [
    { title: 'Upload photos', who: 'You' },
    { title: 'Review the draft', who: drafting ? 'Sayso is drafting…' : 'AI drafts, you check' },
    { title: paypalLogin ? 'Publish with PayPal' : 'Publish', who: paypalLogin ? 'Your PayPal is your login' : 'You confirm' },
  ];
  const now = drafting ? 2 : step;
  return (
    <ol className="sell-steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < now ? 'done' : n === now ? 'now' : 'later';
        return (
          <li key={s.title} className={`sell-step sell-step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="sell-step-n" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={14} /> : n}
            </span>
            <span className="stack" style={{ gap: 0, minWidth: 0 }}>
              <b>{s.title}</b>
              <span className="small soft">{s.who}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Step 1: the photos, the shop's name and where it ships from; notes only if they want. */
function Upload({ photos, setPhotos, onDraft }: { photos: string[]; setPhotos: (p: string[]) => void; onDraft: (body: Record<string, unknown>) => Promise<void> }) {
  const [over, setOver] = useState(false);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const room = MAX_ONBOARDING_PHOTOS - photos.length;

  async function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, room);
    const read = await Promise.all(images.map((f) => shrink(f).catch(() => undefined)));
    setUnread(read.filter((r) => !r).length);
    setPhotos([...photos, ...read.filter((r): r is string => Boolean(r))]);
  }

  return (
    <form
      className="sell-upload"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setError(undefined);
        await onDraft({
          shop_name: form.get('name') || undefined,
          currency: String(form.get('currency') || '').toUpperCase() || undefined,
          country: String(form.get('country') || '').toUpperCase() || undefined,
          text: text.trim() || undefined,
        }).catch((err: Error) => setError(err.message));
      }}
    >
      <div className="sell-photos">
        {photos.length === 0 ? (
          <label
            className={`sell-drop${over ? ' sell-drop-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void add([...e.dataTransfer.files]);
            }}
          >
            <span className="sell-drop-icon">
              <Icon name="camera" size={28} />
            </span>
            <b>Drop photos of your pieces</b>
            <span className="small soft">or tap to choose · up to {MAX_ONBOARDING_PHOTOS} · JPEG, PNG, WebP or HEIC</span>
            <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
          </label>
        ) : (
          <ul
            className={`sell-thumbs${over ? ' sell-drop-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void add([...e.dataTransfer.files]);
            }}
          >
            {photos.map((src, i) => (
              <li key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo ${i + 1}`} />
                <button type="button" className="sell-thumb-x" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, k) => k !== i))}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
            {room > 0 && (
              <li>
                <label className="sell-add">
                  <Icon name="plus" size={22} />
                  <span className="small">Add more</span>
                  <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
                </label>
              </li>
            )}
          </ul>
        )}
        {unread > 0 && <p className="small error">{unread === 1 ? "One photo couldn't be read here" : `${unread} photos couldn't be read here`}; try a JPEG or PNG.</p>}
      </div>

      <div className="sell-details">
        <div className="field">
          <label htmlFor="name">Shop name</label>
          <input id="name" name="name" placeholder="Maya Ceramics" maxLength={60} autoComplete="organization" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="country">Ships from</label>
            <input id="country" name="country" placeholder="US" maxLength={2} autoCapitalize="characters" />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <input id="currency" name="currency" placeholder="USD" maxLength={3} autoCapitalize="characters" />
          </div>
        </div>
        <details className="sell-notes" open={Boolean(text)}>
          <summary className="small">Add prices or notes (optional)</summary>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={8000}
            rows={4}
            aria-label="Prices or notes"
            placeholder="Prices, how many you have, where you ship. A price list or a caption works too."
          />
          <button type="button" className="link-button small" onClick={() => setText(EXAMPLE)}>
            Use an example
          </button>
        </details>
        <button className="btn btn-primary btn-large" disabled={photos.length === 0 && !text.trim()}>
          Draft my shop
        </button>
        {error && <p className="small error">{error}</p>}
        <p className="small muted">Nothing goes live until you check it and confirm every price.</p>
      </div>
    </form>
  );
}

/** While the AI reads the photos: the photos themselves, waiting to become pieces. */
function Drafting({ photos }: { photos: string[] }) {
  return (
    <section className="sell-drafting" aria-live="polite">
      <p className="soft">Naming your pieces and looking up what similar items sell for…</p>
      <ul className="sell-cards">
        {(photos.length ? photos : [undefined, undefined]).map((src, i) => (
          <li key={i} className="sell-card sell-card-loading">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="sell-card-photo">{src && <img src={src} alt="" />}</div>
            <div className="sell-card-body">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" style={{ width: '60%' }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Edits = Record<string, { name: string; description: string; remove: boolean }>;
type VariantEdits = Record<string, { title: string; price: string; stock: number; confirmed: boolean }>;

/** Step 2 (and the way to 3): the draft as editable cards, and Publish once every price is the owner's. */
function Review({ created, paypalLogin, onStartOver }: { created: Created; paypalLogin: boolean; onStartOver: () => void }) {
  const { draft } = created;
  const symbol = currencySymbol(draft.shop.currency);
  const [shopName, setShopName] = useState(draft.shop.name);
  const [products, setProducts] = useState<Edits>(() => Object.fromEntries(draft.products.map((p) => [p.id, { name: p.name, description: p.description, remove: false }])));
  const [variants, setVariants] = useState<VariantEdits>(() =>
    Object.fromEntries(draft.products.flatMap((p) => p.variants.map((v) => [v.id, { title: v.title, price: v.price, stock: v.stock, confirmed: !v.to_confirm }]))),
  );
  const [shipping, setShipping] = useState(() => Object.fromEntries(draft.shipping.map((s) => [s.id, { price: s.price, free_above: s.free_above }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [secretNext, setSecretNext] = useState<string>();

  const kept = draft.products.filter((p) => !products[p.id].remove);
  const unconfirmed = kept.flatMap((p) => p.variants).filter((v) => !variants[v.id].confirmed || !variants[v.id].price.trim()).length;
  const setVariant = (id: string, change: Partial<VariantEdits[string]>) => setVariants((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  async function publish() {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        shop_name: shopName,
        products: draft.products.map((p) => ({
          id: p.id,
          ...(products[p.id].remove
            ? { remove: true }
            : {
                name: products[p.id].name,
                description: products[p.id].description,
                variants: p.variants.map((v) => ({ id: v.id, title: variants[v.id].title, price: variants[v.id].price, stock: variants[v.id].stock })),
              }),
        })),
        shipping: draft.shipping.map((s) => ({ id: s.id, price: shipping[s.id].price, free_above: shipping[s.id].free_above })),
        publish: true,
      };
      const { next } = await callApi<{ next: string }>('/api/onboarding/draft', 'PUT', body);
      if (paypalLogin) window.location.href = next;
      else setSecretNext(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="sell-review" aria-labelledby="review-title">
      <div className="sell-review-head">
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label htmlFor="shop-name" id="review-title">
            Your shop
          </label>
          <input id="shop-name" className="sell-shop-name" value={shopName} onChange={(e) => setShopName(e.target.value)} maxLength={60} />
        </div>
        <span className="small soft">
          {kept.length} piece{kept.length === 1 ? '' : 's'} · ships from {draft.shop.country} · {draft.shop.currency}
        </span>
      </div>

      <ul className="sell-cards">
        {draft.products.map((p) =>
          products[p.id].remove ? (
            <li key={p.id} className="sell-card sell-card-removed">
              <span className="small soft">{products[p.id].name} won&apos;t be in your shop.</span>
              <button type="button" className="link-button small" onClick={() => setProducts((all) => ({ ...all, [p.id]: { ...all[p.id], remove: false } }))}>
                Undo
              </button>
            </li>
          ) : (
            <li key={p.id} className="sell-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="sell-card-photo">{p.image && <img src={p.image} alt="" />}</div>
              <div className="sell-card-body">
                <input className="sell-card-name" value={products[p.id].name} onChange={(e) => setProducts((all) => ({ ...all, [p.id]: { ...all[p.id], name: e.target.value } }))} maxLength={120} aria-label="Name" />
                <textarea
                  className="sell-card-desc"
                  value={products[p.id].description}
                  onChange={(e) => setProducts((all) => ({ ...all, [p.id]: { ...all[p.id], description: e.target.value } }))}
                  rows={3}
                  maxLength={2000}
                  aria-label={`Description of ${products[p.id].name}`}
                />
                <ul className="sell-variants">
                  {p.variants.map((v) => {
                    const edit = variants[v.id];
                    const waiting = !edit.confirmed || !edit.price.trim();
                    return (
                      <li key={v.id} className="sell-variant">
                        {p.variants.length > 1 || v.title !== 'Default' ? (
                          <input className="sell-vtitle" value={edit.title} onChange={(e) => setVariant(v.id, { title: e.target.value })} maxLength={80} aria-label="Variant" />
                        ) : (
                          <span className="sell-vtitle small soft">Price and stock</span>
                        )}
                        <label className={waiting ? 'sell-price sell-price-waiting' : 'sell-price'}>
                          <span aria-hidden="true">{symbol}</span>
                          <input value={edit.price} onChange={(e) => setVariant(v.id, { price: e.target.value, confirmed: true })} inputMode="decimal" maxLength={12} aria-label={`Price of ${edit.title}`} placeholder="0.00" />
                        </label>
                        {v.made_to_order_days !== undefined ? (
                          <span className="small soft sell-qty">{v.made_to_order_days} days to make</span>
                        ) : (
                          <label className="sell-qty">
                            <input type="number" min={0} max={100000} value={edit.stock} onChange={(e) => setVariant(v.id, { stock: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label={`Stock of ${edit.title}`} />
                            <span>in stock</span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Suggestion
                  waiting={p.variants.filter((v) => !variants[v.id].confirmed || !variants[v.id].price.trim())}
                  edits={variants}
                  symbol={symbol}
                  onKeep={(ids) => setVariants((all) => ({ ...all, ...Object.fromEntries(ids.map((id) => [id, { ...all[id], confirmed: true }])) }))}
                />
                <button type="button" className="link-button small sell-remove" onClick={() => setProducts((all) => ({ ...all, [p.id]: { ...all[p.id], remove: true } }))}>
                  Leave this piece out
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {draft.shipping.map((s) => (
        <div key={s.id} className="sell-shipping">
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <b>Shipping</b>
            <span className="small soft">
              {s.name} · {s.countries.includes('*') ? 'worldwide' : s.countries.join(', ')} · {s.days} days
            </span>
          </span>
          <label className="sell-price">
            <span aria-hidden="true">{symbol}</span>
            <input value={shipping[s.id].price} onChange={(e) => setShipping((all) => ({ ...all, [s.id]: { ...all[s.id], price: e.target.value } }))} inputMode="decimal" maxLength={12} aria-label="Shipping price" />
          </label>
          <label className="sell-free small soft">
            free over
            <span className="sell-price">
              <span aria-hidden="true">{symbol}</span>
              <input value={shipping[s.id].free_above} onChange={(e) => setShipping((all) => ({ ...all, [s.id]: { ...all[s.id], free_above: e.target.value } }))} inputMode="decimal" maxLength={12} aria-label="Free shipping above" placeholder="—" />
            </span>
          </label>
        </div>
      ))}

      {secretNext ? (
        <div className="sell-bar">
          <div className="stack" style={{ gap: 'var(--s2)', flex: 1, minWidth: 0 }}>
            <b>Saved. Sign in with your owner secret to publish.</b>
            <CopyField value={created.owner_secret ?? ''} secret />
          </div>
          <a className="btn btn-primary" href={secretNext}>
            Sign in
          </a>
        </div>
      ) : (
        <div className="sell-bar">
          <span className={unconfirmed ? 'sell-bar-status sell-bar-wait' : 'sell-bar-status sell-bar-ok'}>
            {unconfirmed ? `${unconfirmed} price${unconfirmed === 1 ? '' : 's'} to confirm` : 'Ready to publish'}
          </span>
          {error && <span className="small error">{error}</span>}
          <span className="sell-bar-actions">
            <button type="button" className="btn btn-quiet" onClick={onStartOver} disabled={busy}>
              Start over
            </button>
            <button type="button" className={paypalLogin ? 'btn btn-paypal' : 'btn btn-primary'} disabled={busy || unconfirmed > 0 || kept.length === 0} onClick={() => void publish()}>
              {busy ? 'Saving…' : paypalLogin ? 'Publish with PayPal' : 'Save and publish'}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

/** One line per piece whose prices aren't the owner's yet: where the suggestion came from, and keeping it. */
function Suggestion({ waiting, edits, symbol, onKeep }: { waiting: DraftView['products'][number]['variants']; edits: VariantEdits; symbol: string; onKeep: (ids: string[]) => void }) {
  if (!waiting.length) return null;
  const suggested = waiting.find((v) => v.suggested)?.suggested;
  const priced = waiting.every((v) => edits[v.id].price.trim());
  const prices = [...new Set(waiting.map((v) => edits[v.id].price))];
  return (
    <div className="sell-suggest small">
      <span>{suggested ? `Suggested from ${suggested.listings} similar items, ${suggested.low}–${suggested.high}.` : 'Set your price.'}</span>
      {priced && (
        <button type="button" className="btn btn-small" onClick={() => onKeep(waiting.map((v) => v.id))}>
          {prices.length === 1 ? `Keep ${symbol}${prices[0]}` : 'Keep these prices'}
        </button>
      )}
    </div>
  );
}

function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
