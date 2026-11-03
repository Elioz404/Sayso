'use client';

// Photos + a few lines about the shop -> draft catalog. Photos are downscaled in the browser so a
// phone picture uploads fast and stays under the server's limit.

import { useState } from 'react';

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

export function OnboardForm({ origin }: { origin: string }) {
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Created>();

  if (created) return <CreatedShop created={created} origin={origin} />;

  return (
    <form
      className="card"
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
              text: form.get('text') || undefined,
              currency: form.get('currency') || undefined,
              country: form.get('country') || undefined,
              images,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
          setCreated(data);
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <label htmlFor="name">Shop name</label>
      <input id="name" name="name" placeholder="Maya Ceramics" maxLength={80} />

      <label htmlFor="text">What do you sell?</label>
      <textarea
        id="text"
        name="text"
        maxLength={8000}
        placeholder={'Paste a price list, an Instagram caption or just describe it:\n\nHand-thrown mugs, 12 oz, $34. Sage green (6) and speckled white (1).\nRamen bowls $48, 3 left. Ship USPS in the US for $8.95, free over $75.'}
      />

      <label htmlFor="photos">Photos (optional, up to 8)</label>
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
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`Photo ${i + 1}`} />
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label htmlFor="currency">Currency</label>
          <input id="currency" name="currency" placeholder="USD" maxLength={3} />
        </div>
        <div>
          <label htmlFor="country">Ships from</label>
          <input id="country" name="country" placeholder="US" maxLength={2} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" disabled={busy}>{busy ? 'Reading your catalog...' : 'Draft my shop'}</button>
        <span className="muted small">Nothing goes live until you review and publish it.</span>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    </form>
  );
}

function CreatedShop({ created, origin }: { created: Created; origin: string }) {
  const mcpConfig = JSON.stringify(
    { mcpServers: { [created.shop.slug]: { url: created.mcp.seller, headers: { Authorization: `Bearer ${created.agent_key}` } } } },
    null,
    2,
  );
  return (
    <div className="stack">
      <div className="card">
        <h3 className="ok">Drafted {created.shop.name} with {created.products} product(s)</h3>
        {created.questions.length > 0 && (
          <>
            <p className="small">Check these before publishing:</p>
            <ul className="small">{created.questions.map((q) => <li key={q}>{q}</li>)}</ul>
          </>
        )}
      </div>

      <div className="card warn">
        <h3>Save these now. They are shown only once.</h3>
        <p className="small"><b>Owner secret</b>: signs you in and approves money moves. Keep it away from your agents.</p>
        <div className="secret">{created.owner_secret}</div>
        <p className="small" style={{ marginTop: 12 }}><b>Agent key</b>: for your own AI agent. It can run the shop, never approve.</p>
        <div className="secret">{created.agent_key}</div>
        <p className="small" style={{ marginTop: 12 }}>Shop id: <code>{created.shop.slug}</code></p>
      </div>

      <div className="card">
        <ol className="steps">
          <li>
            <a href="/owner">Sign in as the owner</a>, review the catalog and press <b>Publish</b>.
          </li>
          <li>
            Run it from your terminal:
            <pre>{`node cli/sayso.ts login --url ${origin} --key ${created.agent_key}\nnode cli/sayso.ts status`}</pre>
          </li>
          <li>
            Or add it to any MCP client:
            <pre>{mcpConfig}</pre>
          </li>
          <li>
            Buyer agents shop at <code>{created.mcp.buyer}</code> once you publish.
          </li>
        </ol>
      </div>
    </div>
  );
}
