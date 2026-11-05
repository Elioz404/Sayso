'use client';

// "Add from a photo", in the same three steps as Start selling: drop or shoot photos (or share them to the
// installed app on Android), Sayso drafts each product with what similar items sell for, and the owner
// checks the cards and puts each one on sale at their own price.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MAX_DRAFT_PHOTOS, MAX_STOCK } from '@/core/limits.ts';
import { callApi } from './api.ts';
import { currencySymbol } from './catalog-editor.tsx';
import { shrink } from './images.ts';
import { PhotoDrop } from './photo-drop.tsx';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';

/** Must match the cache public/sw.js puts shared photos in. */
const SHARE_CACHE = 'sayso-share';

export interface DraftView {
  id: string;
  name: string;
  description: string;
  image?: string;
  /** "Similar items sell for $30 to $42 (12 listings)", once for the product. */
  suggested?: string;
  variants: { id: string; title: string; price: string; inventory: number; madeToOrder: boolean }[];
}

export function PhotoDrafter({ drafts, sharedCount, currency }: { drafts: DraftView[]; sharedCount: number; currency: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useAction();
  const step = busy ? 2 : drafts.length ? 2 : 1;

  // Photos shared to the installed app wait in the service worker's cache.
  useEffect(() => {
    if (!sharedCount || !('caches' in window)) return;
    (async () => {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const blobs = await Promise.all(keys.map(async (k) => (await cache.match(k))!.blob()));
      await Promise.all(keys.map((k) => cache.delete(k)));
      const read = await Promise.all(blobs.filter((b) => b.type.startsWith('image/')).map((b) => shrink(b)));
      setPhotos((now) => [...now, ...read].slice(0, MAX_DRAFT_PHOTOS));
    })().catch(() => setError('Could not read the shared photos; pick them here instead.'));
  }, [sharedCount, setError]);

  const draft = () =>
    run(async () => {
      await callApi('/api/owner/drafts', 'POST', { images: photos, note: note || undefined });
      setPhotos([]);
      setNote('');
      router.refresh();
    });

  return (
    <div className="sell">
      <ol className="sell-steps">
        {[
          { title: 'Upload photos', who: 'You' },
          { title: 'Review the draft', who: busy ? 'Sayso is drafting…' : 'AI drafts, you check' },
          { title: 'Put it on sale', who: 'You confirm the price' },
        ].map((s, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'now' : 'later';
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

      {busy ? (
        <section className="sell-drafting" aria-live="polite">
          <p className="soft">Naming your pieces and looking up what similar items sell for…</p>
          <ul className="sell-cards">
            {photos.map((src, i) => (
              <li key={i} className="sell-card sell-card-loading">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="sell-card-photo">
                  <img src={src} alt="" />
                </div>
                <div className="sell-card-body">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" style={{ width: '60%' }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <form
          className="sell-upload"
          onSubmit={(e) => {
            e.preventDefault();
            void draft();
          }}
        >
          <PhotoDrop photos={photos} setPhotos={setPhotos} max={MAX_DRAFT_PHOTOS} />
          <div className="sell-details">
            <div className="field">
              <label htmlFor="draft-note">Anything a photo can&apos;t show (optional)</label>
              <textarea id="draft-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Stoneware, 12 oz, dishwasher safe. 4 of each." />
            </div>
            <button className="btn btn-primary btn-large" disabled={photos.length === 0}>
              Draft {photos.length > 1 ? 'products' : 'a product'}
            </button>
            {error && <p className="small error">{error}</p>}
            <p className="small muted">Nothing goes on sale until you check it and set the price.</p>
          </div>
        </form>
      )}

      {drafts.length > 0 && (
        <section className="sell-review" aria-labelledby="drafts">
          <div className="sell-review-head">
            <h2 id="drafts" className="h3">
              Check {drafts.length === 1 ? 'it' : `these ${drafts.length}`} and put {drafts.length === 1 ? 'it' : 'them'} on sale
            </h2>
          </div>
          <ul className="sell-cards">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} currency={currency} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DraftCard({ draft, currency }: { draft: DraftView; currency: string }) {
  const router = useRouter();
  const symbol = currencySymbol(currency);
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [variants, setVariants] = useState(draft.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, inventory: v.inventory })));
  const { busy, error, run } = useAction();
  const edit = (i: number, patch: Partial<(typeof variants)[number]>) => setVariants((now) => now.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const priced = variants.every((v) => v.price.trim());

  const sell = () =>
    run(async () => {
      await callApi(`/api/owner/drafts/${draft.id}`, 'POST', { name, description, variants: variants.map((v) => ({ id: v.id, price: v.price, inventory: v.inventory })) });
      router.push(`/owner/catalog?added=${encodeURIComponent(name)}`);
    }, 'sell');

  const discard = () =>
    run(async () => {
      await callApi(`/api/owner/drafts/${draft.id}`, 'DELETE');
      router.refresh();
    }, 'discard');

  return (
    <li className="sell-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="sell-card-photo">{draft.image && <img src={draft.image} alt="" />}</div>
      <div className="sell-card-body">
        <input className="sell-card-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" />
        <textarea className="sell-card-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} aria-label={`Description of ${name}`} />
        <ul className="sell-variants">
          {draft.variants.map((v, i) => (
            <li key={v.id} className="sell-variant">
              {draft.variants.length > 1 || v.title !== 'Default' ? <span className="sell-vtitle small">{v.title}</span> : <span className="sell-vtitle small soft">Price and stock</span>}
              <label className={variants[i].price.trim() ? 'sell-price' : 'sell-price sell-price-waiting'}>
                <span aria-hidden="true">{symbol}</span>
                <input value={variants[i].price} onChange={(e) => edit(i, { price: e.target.value })} inputMode="decimal" maxLength={12} aria-label={`Price of ${v.title}`} placeholder="0.00" />
              </label>
              <label className="sell-qty">
                <input type="number" min={0} max={MAX_STOCK} value={variants[i].inventory} onChange={(e) => edit(i, { inventory: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label={`Stock of ${v.title}`} />
                <span>{v.madeToOrder ? 'ready now' : 'in stock'}</span>
              </label>
            </li>
          ))}
        </ul>
        {draft.suggested && <div className="sell-suggest small">{draft.suggested}</div>}
        <div className="sell-card-actions">
          <button type="button" className="link-button small sell-remove" disabled={Boolean(busy)} onClick={() => void discard()}>
            {busy === 'discard' ? 'Discarding…' : 'Discard'}
          </button>
          <button type="button" className="btn btn-primary btn-small" style={{ marginLeft: 'auto' }} disabled={Boolean(busy) || !priced} onClick={() => void sell()}>
            {busy === 'sell' ? 'Putting it on sale…' : 'Put it on sale'}
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
  );
}
