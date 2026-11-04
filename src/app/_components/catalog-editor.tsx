'use client';

// The owner's catalog, edited in place: each product as a card like the ones in Start selling (photo,
// name, description, each option's price and stock), saved when the owner says so; and the shipping
// prices. The shared demo shows them read-only.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';
import { shrink } from './images.ts';
import { useAction } from './use-action.ts';

export interface EditableProduct {
  id: string;
  name: string;
  description: string;
  image?: string;
  variants: { id: string; title: string; price: string; stock: number | null; madeDays?: number; sold: number; toConfirm: boolean }[];
}

export interface EditableShipping {
  id: string;
  name: string;
  where: string;
  days: string;
  price: string;
  freeAbove: string;
}

export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function ProductCard({ product, currency, readOnly }: { product: EditableProduct; currency: string; readOnly: boolean }) {
  const router = useRouter();
  const symbol = currencySymbol(currency);
  const start = () => ({
    name: product.name,
    description: product.description,
    variants: Object.fromEntries(product.variants.map((v) => [v.id, { title: v.title, price: v.price, stock: v.stock ?? 0 }])),
  });
  const [edit, setEdit] = useState(start);
  const [photo, setPhoto] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const setVariant = (id: string, change: Partial<(typeof edit.variants)[string]>) => {
    setSaved(false);
    setEdit((e) => ({ ...e, variants: { ...e.variants, [id]: { ...e.variants[id], ...change } } }));
  };
  const dirty =
    Boolean(photo) ||
    edit.name !== product.name ||
    edit.description !== product.description ||
    product.variants.some((v) => {
      const e = edit.variants[v.id];
      return e.title !== v.title || e.price !== v.price || (v.stock !== null && e.stock !== v.stock);
    });

  const save = () =>
    run(async () => {
      await callApi(`/api/owner/products/${product.id}`, 'PATCH', {
        ...(edit.name !== product.name ? { name: edit.name } : {}),
        ...(edit.description !== product.description ? { description: edit.description } : {}),
        ...(photo ? { photo } : {}),
        variants: product.variants
          .map((v) => {
            const e = edit.variants[v.id];
            return {
              id: v.id,
              ...(e.title !== v.title ? { title: e.title } : {}),
              ...(e.price !== v.price ? { price: e.price } : {}),
              ...(v.stock !== null && e.stock !== v.stock ? { stock: e.stock } : {}),
            };
          })
          .filter((v) => Object.keys(v).length > 1),
      });
      setPhoto(undefined);
      setSaved(true);
      router.refresh();
    }, 'save');

  const remove = () =>
    run(async () => {
      await callApi(`/api/owner/products/${product.id}`, 'DELETE');
      router.refresh();
    }, 'remove');

  const shown = photo ?? product.image;
  return (
    <li className="sell-card">
      <div className="sell-card-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown && <img src={shown} alt="" />}
        {!readOnly && (
          <label className="sell-card-photo-change small">
            Change photo
            <input
              type="file"
              accept="image/*,.heic,.heif"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setSaved(false);
                setPhoto(await shrink(file));
              }}
            />
          </label>
        )}
      </div>
      <div className="sell-card-body">
        <input className="sell-card-name" value={edit.name} readOnly={readOnly} onChange={(e) => (setSaved(false), setEdit((x) => ({ ...x, name: e.target.value })))} maxLength={120} aria-label="Name" />
        <textarea
          className="sell-card-desc"
          value={edit.description}
          readOnly={readOnly}
          onChange={(e) => (setSaved(false), setEdit((x) => ({ ...x, description: e.target.value })))}
          rows={3}
          maxLength={2000}
          aria-label={`Description of ${edit.name}`}
        />
        <ul className="sell-variants">
          {product.variants.map((v) => {
            const e = edit.variants[v.id];
            return (
              <li key={v.id} className="sell-variant">
                {product.variants.length > 1 || v.title !== 'Default' ? (
                  <input className="sell-vtitle" value={e.title} readOnly={readOnly} onChange={(x) => setVariant(v.id, { title: x.target.value })} maxLength={80} aria-label="Option" />
                ) : (
                  <span className="sell-vtitle small soft">Price and stock</span>
                )}
                <label className={v.toConfirm ? 'sell-price sell-price-waiting' : 'sell-price'}>
                  <span aria-hidden="true">{symbol}</span>
                  <input value={e.price} readOnly={readOnly} onChange={(x) => setVariant(v.id, { price: x.target.value })} inputMode="decimal" maxLength={12} aria-label={`Price of ${e.title}`} />
                </label>
                {v.stock === null ? (
                  <span className="small soft sell-qty">{v.madeDays} days to make</span>
                ) : (
                  <label className={`sell-qty${v.stock === 0 ? ' sell-qty-out' : ''}`}>
                    <input type="number" min={0} max={100000} value={e.stock} readOnly={readOnly} onChange={(x) => setVariant(v.id, { stock: Math.max(0, Math.floor(Number(x.target.value) || 0)) })} aria-label={`Stock of ${e.title}`} />
                    <span>{v.stock === 0 && e.stock === 0 ? 'sold out' : 'in stock'}</span>
                  </label>
                )}
                {v.sold > 0 && <span className="small muted sell-sold">{v.sold} sold in 14 days</span>}
              </li>
            );
          })}
        </ul>
        {!readOnly && (
          <div className="sell-card-actions">
            {removing ? (
              <span className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
                <span className="small soft">Take {product.name} off sale for good?</span>
                <button type="button" className="btn btn-danger btn-small" disabled={Boolean(busy)} onClick={() => void remove()}>
                  {busy === 'remove' ? 'Removing…' : 'Remove'}
                </button>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setRemoving(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <>
                <button type="button" className="link-button small sell-remove" onClick={() => setRemoving(true)}>
                  Remove product
                </button>
                <span className="row" style={{ gap: 'var(--s2)', marginLeft: 'auto' }}>
                  {saved && !dirty && <span className="small ok-text">Saved</span>}
                  {dirty && (
                    <button type="button" className="btn btn-quiet btn-small" disabled={Boolean(busy)} onClick={() => (setEdit(start()), setPhoto(undefined))}>
                      Undo
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-small" disabled={!dirty || Boolean(busy)} onClick={() => void save()}>
                    {busy === 'save' ? 'Saving…' : 'Save changes'}
                  </button>
                </span>
              </>
            )}
          </div>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
  );
}

export function ShippingEditor({ rules, currency, readOnly }: { rules: EditableShipping[]; currency: string; readOnly: boolean }) {
  const router = useRouter();
  const symbol = currencySymbol(currency);
  const [edit, setEdit] = useState(() => Object.fromEntries(rules.map((r) => [r.id, { price: r.price, freeAbove: r.freeAbove }])));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const dirty = rules.some((r) => edit[r.id].price !== r.price || edit[r.id].freeAbove !== r.freeAbove);
  const set = (id: string, change: Partial<(typeof edit)[string]>) => {
    setSaved(false);
    setEdit((all) => ({ ...all, [id]: { ...all[id], ...change } }));
  };

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      {rules.map((r) => (
        <div key={r.id} className="sell-shipping">
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <b>{r.name}</b>
            <span className="small soft">
              {r.where} · {r.days}
            </span>
          </span>
          <label className="sell-price">
            <span aria-hidden="true">{symbol}</span>
            <input value={edit[r.id].price} readOnly={readOnly} onChange={(e) => set(r.id, { price: e.target.value })} inputMode="decimal" maxLength={12} aria-label={`${r.name} price`} />
          </label>
          <label className="sell-free small soft">
            free over
            <span className="sell-price">
              <span aria-hidden="true">{symbol}</span>
              <input value={edit[r.id].freeAbove} readOnly={readOnly} onChange={(e) => set(r.id, { freeAbove: e.target.value })} inputMode="decimal" maxLength={12} aria-label="Free shipping above" placeholder="—" />
            </span>
          </label>
        </div>
      ))}
      {!readOnly && (
        <div className="row" style={{ gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          {saved && !dirty && <span className="small ok-text">Saved</span>}
          {error && <span className="small error">{error}</span>}
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!dirty || Boolean(busy)}
            onClick={() =>
              void run(async () => {
                await callApi('/api/owner/shipping', 'PUT', { rules: rules.map((r) => ({ id: r.id, price: edit[r.id].price, free_above: edit[r.id].freeAbove })) });
                setSaved(true);
                router.refresh();
              })
            }
          >
            {busy ? 'Saving…' : 'Save shipping'}
          </button>
        </div>
      )}
    </div>
  );
}
