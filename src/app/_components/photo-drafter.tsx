'use client';

// "Add from a photo": snap or pick product photos (or share them to the installed app on Android),
// Sayso drafts each product with a market price, and it goes on sale once the owner sets the price.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_DRAFT_PHOTOS } from '@/core/photo-limits.ts';
import { callApi } from './api.ts';
import { shrink } from './images.ts';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';

/** Must match the cache public/sw.js puts shared photos in. */
const SHARE_CACHE = 'sayso-share';

export interface DraftView {
  id: string;
  name: string;
  description: string;
  image?: string;
  variants: { id: string; title: string; price: string; suggested?: string; inventory: number; madeToOrder: boolean }[];
}

export function PhotoDrafter({ drafts, sharedCount }: { drafts: DraftView[]; sharedCount: number }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useAction();
  const full = photos.length >= MAX_DRAFT_PHOTOS;

  const add = useCallback(async (files: Blob[]) => {
    const next = await Promise.all(files.slice(0, MAX_DRAFT_PHOTOS).map((f) => shrink(f)));
    setPhotos((now) => [...now, ...next].slice(0, MAX_DRAFT_PHOTOS));
  }, []);

  // Photos shared to the installed app wait in the service worker's cache.
  useEffect(() => {
    if (!sharedCount || !('caches' in window)) return;
    (async () => {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const blobs = await Promise.all(keys.map(async (k) => (await cache.match(k))!.blob()));
      await Promise.all(keys.map((k) => cache.delete(k)));
      await add(blobs.filter((b) => b.type.startsWith('image/')));
    })().catch(() => setError('Could not read the shared photos; pick them here instead.'));
  }, [sharedCount, add, setError]);

  const draft = () =>
    run(async () => {
      await callApi('/api/owner/drafts', 'POST', { images: photos, note: note || undefined });
      setPhotos([]);
      setNote('');
      router.refresh();
    });

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <section className="panel stack" style={{ gap: 14 }} aria-label="New photos">
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && void add([...e.target.files])} />
        <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void add([...e.target.files])} />
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-big" disabled={Boolean(busy) || full} onClick={() => camera.current?.click()}>
            <Icon name="camera" size={20} /> Take a photo
          </button>
          <button className="btn btn-big" disabled={Boolean(busy) || full} onClick={() => gallery.current?.click()}>
            Choose photos
          </button>
        </div>
        {photos.length > 0 && (
          <ul className="shots">
            {photos.map((p, i) => (
              <li key={i}>
                <img src={p} alt={`Photo ${i + 1}`} />
                <button className="shots-x" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((now) => now.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="field">
          <label htmlFor="draft-note">Anything a photo can’t show (optional)</label>
          <input id="draft-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Stoneware, 12 oz, dishwasher safe. 4 of each." />
        </div>
        <button className="btn btn-primary" disabled={Boolean(busy) || photos.length === 0} onClick={() => void draft()}>
          {busy ? 'Sayso is looking at your photos...' : `Draft ${photos.length > 1 ? 'products' : 'a product'} from ${photos.length || 'your'} photo${photos.length === 1 ? '' : 's'}`}
        </button>
        {error && <p className="error small">{error}</p>}
        <p className="small muted">Sayso names and describes what it sees and looks up what similar items sell for. Nothing goes on sale until you set the price.</p>
      </section>

      {drafts.length > 0 && (
        <section className="stack" style={{ gap: 'var(--s4)' }} aria-labelledby="drafts">
          <h2 id="drafts">Waiting for your price</h2>
          <ul className="photo-drafts">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: DraftView }) {
  const router = useRouter();
  const [name, setName] = useState(draft.name);
  const [variants, setVariants] = useState(draft.variants.map((v) => ({ id: v.id, price: v.price, inventory: String(v.inventory) })));
  const { busy, error, run } = useAction();
  const edit = (i: number, patch: Partial<(typeof variants)[number]>) => setVariants((now) => now.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const sell = () =>
    run(async () => {
      await callApi(`/api/owner/drafts/${draft.id}`, 'POST', { name, variants: variants.map((v) => ({ id: v.id, price: v.price, inventory: Number(v.inventory) })) });
      router.push(`/owner/catalog?added=${encodeURIComponent(name)}`);
    }, 'sell');

  const discard = () =>
    run(async () => {
      await callApi(`/api/owner/drafts/${draft.id}`, 'DELETE');
      router.refresh();
    }, 'discard');

  return (
    <li className="photo-draft">
      {draft.image ? <img src={draft.image} alt={draft.name} className="draft-shot" /> : <div className="draft-shot" aria-hidden="true" />}
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <div className="field">
          <label htmlFor={`name-${draft.id}`}>Name</label>
          <input id={`name-${draft.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <p className="small soft">{draft.description}</p>
        {draft.variants.map((v, i) => (
          <div key={v.id} className="photo-draft-variant">
            {draft.variants.length > 1 && <b className="small">{v.title}</b>}
            <div className="field">
              <label htmlFor={`price-${v.id}`}>Price</label>
              <input id={`price-${v.id}`} inputMode="decimal" value={variants[i].price} onChange={(e) => edit(i, { price: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`stock-${v.id}`}>{v.madeToOrder ? 'In stock now' : 'Stock'}</label>
              <input id={`stock-${v.id}`} inputMode="numeric" value={variants[i].inventory} onChange={(e) => edit(i, { inventory: e.target.value.replace(/\D/g, '') })} />
            </div>
            {v.suggested && <span className="small muted photo-draft-hint">{v.suggested}</span>}
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void sell()}>
            {busy === 'sell' ? 'Putting it on sale...' : 'Put it on sale'}
          </button>
          <button className="btn btn-quiet" disabled={Boolean(busy)} onClick={() => void discard()}>
            Discard
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
  );
}
