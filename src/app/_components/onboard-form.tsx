'use client';

// Photos + a few lines about the shop -> draft catalog. Photos are downscaled in the browser so a
// phone picture uploads fast and stays under the server's limit.

import { useState } from 'react';
import { CopyField } from './client-ui.tsx';
import { Icon } from './ui.tsx';

interface Created {
  shop: { slug: string; name: string };
  products: number;
  questions: string[];
  owner_secret: string;
  agent_key: string;
  review_url: string;
  mcp: { seller: string; buyer: string };
}

async function shrink(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const EXAMPLE = `Hand-thrown mugs, 12 oz, $34. Sage green (6 left) and speckled white (1).
Ramen bowls $48, 3 left. Custom bud vases $62, made to order in about 10 days.
USPS in the US $8.95, free over $75. I also ship to Canada for $28.`;

export function OnboardForm({ origin }: { origin: string }) {
  const [images, setImages] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Created>();

  if (created) return <CreatedShop created={created} origin={origin} />;

  return (
    <form
      className="panel stack"
      style={{ gap: 'var(--s5)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(undefined);
        try {
          const res = await fetch('/api/shops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shop_name: form.get('name') || undefined,
              text: text || undefined,
              currency: form.get('currency') || undefined,
              country: form.get('country') || undefined,
              images,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message ?? `Something went wrong (${res.status})`);
          setCreated(data);
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor="name">Shop name</label>
        <input id="name" name="name" placeholder="Maya Ceramics" maxLength={80} />
      </div>

      <div className="field">
        <div className="spread">
          <label htmlFor="text">What you sell</label>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setText(EXAMPLE)}>
            Use an example
          </button>
        </div>
        <textarea
          id="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={8000}
          placeholder="Paste a price list or an Instagram caption, or just describe it: products, prices, how many you have, where you ship and what it costs."
        />
      </div>

      <div className="field">
        <span className="small soft" style={{ fontWeight: 600 }}>Photos (optional, up to 8)</span>
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
              const files = [...(e.target.files ?? [])].slice(0, 8);
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

      <div className="row" style={{ gap: 14 }}>
        <button className="btn btn-primary" disabled={busy || (!text.trim() && images.length === 0)}>
          {busy ? 'Reading your catalog...' : 'Draft my shop'}
        </button>
        <span className="small soft">Nothing goes live until you publish it.</span>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function CreatedShop({ created, origin }: { created: Created; origin: string }) {
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <div className="panel stack" style={{ gap: 'var(--s3)' }}>
        <span className="status status-ok">Draft ready</span>
        <h2>
          {created.shop.name}, {created.products} product{created.products === 1 ? '' : 's'}
        </h2>
        {created.questions.length > 0 && (
          <>
            <p className="soft small">Check these before you publish:</p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {created.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="panel panel-hold stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2>Save these two keys now</h2>
          <p className="small soft">They are shown only once. Store them in a password manager.</p>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Owner secret: for you. It signs you in and approves money moves.</b>
          <CopyField value={created.owner_secret} secret />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Agent key: for your AI agent. It runs the shop but can never approve.</b>
          <CopyField value={created.agent_key} secret />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Shop ID</b>
          <CopyField value={created.shop.slug} />
        </div>
      </div>

      <div className="panel stack" style={{ gap: 16 }}>
        <h2>Next</h2>
        <ol className="steps">
          <li>
            <span className="stack" style={{ gap: 6 }}>
              <span>
                <a href="/owner">Sign in as the owner</a>, check the catalog and press <b>Publish shop</b>.
              </span>
            </span>
          </li>
          <li>
            <span className="stack" style={{ gap: 6, minWidth: 0 }}>
              <span>Connect your agent from a terminal:</span>
              <CopyField value={`node cli/sayso.ts login --url ${origin} --key ${created.agent_key}`} />
            </span>
          </li>
          <li>
            <span className="stack" style={{ gap: 6, minWidth: 0 }}>
              <span>After you publish, shoppers&apos; assistants buy here:</span>
              <CopyField value={created.mcp.buyer} />
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}
