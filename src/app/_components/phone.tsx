'use client';

// Sayso on the owner's phone: install it, get notified, approve with a passkey, and use the camera
// (a label photo becomes tracking, a product photo becomes a draft). Passkey options are fetched
// before the owner taps, because browsers only open the fingerprint/face prompt straight from a tap.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi } from './api.ts';
import { Icon } from './ui.tsx';

/* ---------- WebAuthn plumbing ---------- */

interface Challenge {
  token: string;
  options: Record<string, any>;
}

export interface PasskeyProof {
  token: string;
  credential: { id: string; clientDataJSON: string; authenticatorData: string; signature: string };
}

const fromB64 = (value: string): ArrayBuffer => {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};
const toB64 = (buffer: ArrayBuffer): string => {
  let bin = '';
  for (const b of new Uint8Array(buffer)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const withIds = (list?: { id: string; type: string; transports?: string[] }[]) => list?.map((c) => ({ ...c, id: fromB64(c.id) })) as PublicKeyCredentialDescriptor[] | undefined;

function passkeyError(err: unknown): Error {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return new Error('Cancelled, or the passkey prompt timed out. Try again.');
  if (name === 'InvalidStateError') return new Error('This device already has a passkey for this shop.');
  if (name === 'SecurityError') return new Error('Passkeys only work on the shop’s real address (https).');
  return err instanceof Error ? err : new Error('The passkey did not work on this device');
}

/** Sign a prefetched challenge with one of the shop's passkeys. Call straight from a tap. */
export async function signChallenge(challenge: Challenge): Promise<PasskeyProof> {
  const o = challenge.options;
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.get({
      publicKey: { ...o, challenge: fromB64(o.challenge), allowCredentials: withIds(o.allowCredentials) } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential;
  } catch (err) {
    throw passkeyError(err);
  }
  const r = credential.response as AuthenticatorAssertionResponse;
  return { token: challenge.token, credential: { id: credential.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) } };
}

async function makePasskey(challenge: Challenge, label: string, proof?: PasskeyProof): Promise<void> {
  const o = challenge.options;
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.create({
      publicKey: { ...o, challenge: fromB64(o.challenge), user: { ...o.user, id: fromB64(o.user.id) }, excludeCredentials: withIds(o.excludeCredentials) } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential;
  } catch (err) {
    throw passkeyError(err);
  }
  const r = credential.response as AuthenticatorAttestationResponse;
  await callApi('/api/owner/passkeys', 'POST', {
    token: challenge.token,
    label,
    proof,
    credential: { id: credential.id, clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports?.() ?? [] },
  });
}

/** A passkey challenge fetched ahead of the tap, and refreshed before it expires. */
export function usePasskeyChallenge(purpose: 'approve' | 'manage' | 'register' | undefined, record?: string) {
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!purpose) return;
    try {
      setChallenge(await callApi<Challenge>('/api/owner/passkeys/options', 'POST', { purpose, record }));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [purpose, record]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4 * 60_000); // the server's challenges last five minutes
    return () => clearInterval(timer);
  }, [load]);
  return { challenge, error, reload: load };
}

/* ---------- Device facts ---------- */

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

const isIos = () => /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/* ---------- The phone setup screen ---------- */

interface BeforeInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PhoneSetup({
  pushKey,
  passkeys,
  devices,
  shared,
}: {
  pushKey: string;
  passkeys: { id: string; label: string; added: string; used?: string; synced: boolean }[];
  devices: string[];
  /** The shared public demo: nothing here can be tied to one visitor's device. */
  shared: boolean;
}) {
  const router = useRouter();
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt>();
  const [push, setPush] = useState<'unknown' | 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked'>('unknown');
  const [passkeyOk, setPasskeyOk] = useState<boolean>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [label, setLabel] = useState('');
  const [manageProof, setManageProof] = useState<PasskeyProof>();
  const register = usePasskeyChallenge(shared ? undefined : 'register');
  const manage = usePasskeyChallenge(shared || passkeys.length === 0 ? undefined : 'manage');

  useEffect(() => {
    setInstalled(isInstalled());
    setIos(isIos());
    setLabel(deviceLabel());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setInstalled(true));
    if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setPasskeyOk, () => setPasskeyOk(false));
    } else setPasskeyOk(false);

    (async () => {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) return setPush(isIos() && !isInstalled() ? 'needs-install' : 'unsupported');
      if (!('PushManager' in window)) return setPush(isIos() && !isInstalled() ? 'needs-install' : 'unsupported');
      if (Notification.permission === 'denied') return setPush('blocked');
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      setPush((await reg.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setPush('unsupported'));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function act(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setMessage(undefined);
    try {
      const text = await fn();
      if (text) setMessage({ tone: 'ok', text });
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: (err as Error).message });
    }
    setBusy(undefined);
  }

  const turnOnPush = () =>
    act('push', async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'blocked' : 'off');
        throw new Error('Notifications were not allowed. You can allow them in this browser’s site settings.');
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64(pushKey) }));
      await callApi('/api/owner/push', 'POST', { subscription: sub.toJSON(), label: deviceLabel() });
      setPush('on');
      await callApi('/api/owner/push/test', 'POST');
      return 'Notifications are on. A test one is on its way.';
    });

  const turnOffPush = () =>
    act('push', async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await callApi('/api/owner/push', 'DELETE', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPush('off');
      return 'Notifications are off on this device.';
    });

  const addPasskey = () =>
    act('passkey', async () => {
      if (!register.challenge) throw new Error(register.error ?? 'Getting ready, try again in a second');
      await makePasskey(register.challenge, label || deviceLabel(), manageProof);
      setManageProof(undefined);
      await Promise.all([register.reload(), manage.reload()]);
      return 'Passkey saved. From now on, every OK is signed by your fingerprint, face or PIN.';
    });

  const confirmFirst = () =>
    act('confirm', async () => {
      if (!manage.challenge) throw new Error(manage.error ?? 'Getting ready, try again in a second');
      setManageProof(await signChallenge(manage.challenge));
      await manage.reload();
      return 'Confirmed. Now make the new passkey on this device.';
    });

  const removePasskey = (id: string) =>
    act(`remove-${id}`, async () => {
      if (!manage.challenge) throw new Error(manage.error ?? 'Getting ready, try again in a second');
      const proof = await signChallenge(manage.challenge);
      await callApi(`/api/owner/passkeys/${encodeURIComponent(id)}`, 'DELETE', { proof });
      await Promise.all([manage.reload(), register.reload()]);
      return 'Passkey removed.';
    });

  const step = (n: number, done: boolean) => <span className={`phone-step${done ? ' phone-step-done' : ''}`}>{done ? <Icon name="check" size={16} /> : n}</span>;

  return (
    <div className="phone-setup">
      <section className="phone-card" aria-labelledby="install">
        {step(1, installed)}
        <div className="phone-card-body">
          <h2 id="install">Put Sayso on your home screen</h2>
          {installed ? (
            <p className="soft">Installed. Sayso opens full screen, straight on your shop.</p>
          ) : installEvent ? (
            <>
              <p className="soft">One tap: it opens like an app, straight on your shop, no app store.</p>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await installEvent.prompt();
                  if ((await installEvent.userChoice).outcome === 'accepted') setInstalled(true);
                }}
              >
                <Icon name="plus" size={18} /> Install Sayso
              </button>
            </>
          ) : ios ? (
            <ol className="phone-how">
              <li>
                Tap <b>Share</b> <span aria-hidden="true">(the square with an arrow)</span> in Safari.
              </li>
              <li>
                Choose <b>Add to Home Screen</b>, then <b>Add</b>.
              </li>
              <li>Open Sayso from your home screen to turn on notifications.</li>
            </ol>
          ) : (
            <p className="soft">Open this page on your phone, then use your browser’s menu: <b>Install app</b> or <b>Add to Home Screen</b>.</p>
          )}
        </div>
      </section>

      <section className="phone-card" aria-labelledby="notify">
        {step(2, push === 'on')}
        <div className="phone-card-body">
          <h2 id="notify">Get a ping when your agent needs you</h2>
          <p className="soft">When an agent’s request waits for your say-so, and when an order is paid. Tap it and you’re on the decision.</p>
          {shared ? (
            <p className="small soft">Not in the shared demo shop: start the judges’ tour for a shop of your own.</p>
          ) : push === 'on' ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="pill pill-ok">
                <Icon name="bell" size={14} /> On for this device
              </span>
              <button className="btn btn-quiet btn-small" disabled={Boolean(busy)} onClick={() => void act('test', async () => (await callApi('/api/owner/push/test', 'POST'), 'Sent. It should show up in a few seconds.'))}>
                Send a test
              </button>
              <button className="btn btn-quiet btn-small" disabled={Boolean(busy)} onClick={() => void turnOffPush()}>
                Turn off
              </button>
            </div>
          ) : push === 'off' ? (
            <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void turnOnPush()}>
              <Icon name="bell" size={18} /> {busy === 'push' ? 'Turning on...' : 'Turn on notifications'}
            </button>
          ) : push === 'needs-install' ? (
            <p className="small soft">On iPhone, notifications work once Sayso is on your home screen (step 1). Open it from there and come back to this step.</p>
          ) : push === 'blocked' ? (
            <p className="small soft">Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.</p>
          ) : push === 'unsupported' ? (
            <p className="small soft">This browser can’t receive notifications. Chrome, Edge, Firefox and Safari (from your home screen) can.</p>
          ) : (
            <p className="small soft">Checking this browser...</p>
          )}
          {devices.length > 0 && <p className="small muted">Notifying: {devices.join(', ')}</p>}
        </div>
      </section>

      <section className="phone-card" aria-labelledby="passkey">
        {step(3, passkeys.length > 0)}
        <div className="phone-card-body">
          <h2 id="passkey">Approve with your fingerprint or face</h2>
          <p className="soft">
            With a passkey, no one can say OK for you: not someone holding your unlocked phone, not a stolen login, not an agent. Each OK is signed by this device over the exact request, and the signature
            is kept in the audit trail.
          </p>
          {passkeys.length > 0 && (
            <ul className="list list-tight">
              {passkeys.map((k) => (
                <li key={k.id} className="spread">
                  <span className="stack" style={{ gap: 2 }}>
                    <b>
                      <Icon name="fingerprint" size={16} /> {k.label}
                    </b>
                    <span className="small muted">
                      Added {k.added}
                      {k.used ? ` · last OK ${k.used}` : ''}
                      {k.synced ? ' · synced with your account' : ''}
                    </span>
                  </span>
                  <button className="btn btn-quiet btn-small" disabled={Boolean(busy) || !manage.challenge} onClick={() => void removePasskey(k.id)}>
                    {busy === `remove-${k.id}` ? 'Removing...' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shared ? (
            <p className="small soft">Not in the shared demo shop: start the judges’ tour for a shop of your own.</p>
          ) : passkeyOk === false ? (
            <p className="small soft">This browser can’t make a passkey. Phones with a fingerprint, face unlock or screen lock can.</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="field">
                <label htmlFor="passkey-label">Name this device</label>
                <input id="passkey-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="My iPhone" />
              </div>
              {passkeys.length > 0 && !manageProof ? (
                <button className="btn" disabled={Boolean(busy) || !manage.challenge} onClick={() => void confirmFirst()}>
                  <Icon name="fingerprint" size={18} /> {busy === 'confirm' ? 'Waiting for your passkey...' : 'Add another: confirm with a passkey you have'}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={Boolean(busy) || !register.challenge} onClick={() => void addPasskey()}>
                  <Icon name="fingerprint" size={18} /> {busy === 'passkey' ? 'Waiting for your device...' : passkeys.length ? 'Make the new passkey' : 'Set up a passkey'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {message && (
        <p className={message.tone === 'error' ? 'error' : 'ok-note'} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

/* ---------- Camera: shipping label -> tracking ---------- */

async function shrink(file: Blob, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const CARRIERS: [string, string][] = [
  ['USPS', 'USPS'],
  ['UPS', 'UPS'],
  ['FEDEX', 'FedEx'],
  ['DHL', 'DHL'],
  ['ONTRAC', 'OnTrac'],
  ['CANADA_POST', 'Canada Post'],
  ['ROYAL_MAIL', 'Royal Mail'],
  ['AUSTRALIA_POST', 'Australia Post'],
  ['CORREOS_ES', 'Correos'],
  ['CORREO_ARGENTINO', 'Correo Argentino'],
  ['OTHER', 'Other'],
];

export function LabelScanner({ orderId }: { orderId: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'read' | 'save'>();
  const [carrier, setCarrier] = useState('USPS');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<string>();

  async function read(picked: File) {
    setBusy('read');
    setError(undefined);
    setNote(undefined);
    try {
      const image = await shrink(picked);
      setPreview(image);
      const r = await callApi<{ carrier: string | null; tracking_number: string | null; note: string | null }>(`/api/owner/orders/${orderId}/label`, 'POST', { image });
      if (r.carrier) setCarrier(r.carrier);
      if (r.tracking_number) setNumber(r.tracking_number);
      setNote(r.note ?? (r.tracking_number ? 'Read from the label. Check it matches, then add it.' : undefined));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(undefined);
  }

  async function save() {
    setBusy('save');
    setError(undefined);
    try {
      await callApi(`/api/owner/orders/${orderId}/tracking`, 'POST', { carrier, tracking_number: number });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(undefined);
    }
  }

  return (
    <div className="scan">
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      <button className="btn btn-primary scan-shoot" disabled={Boolean(busy)} onClick={() => file.current?.click()}>
        <Icon name="camera" size={20} /> {busy === 'read' ? 'Reading the label...' : 'Snap the shipping label'}
      </button>
      <div className="scan-row">
        {preview && <img src={preview} alt="The label you photographed" className="scan-preview" />}
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <div className="field">
            <label htmlFor={`carrier-${orderId}`}>Carrier</label>
            <select id={`carrier-${orderId}`} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`tracking-${orderId}`}>Tracking number</label>
            <input id={`tracking-${orderId}`} className="mono" inputMode="text" autoCapitalize="characters" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="9400 1000 0000 0000 0000 00" />
          </div>
        </div>
      </div>
      {note && <p className="small soft">{note}</p>}
      <button className="btn" disabled={Boolean(busy) || number.replace(/\s/g, '').length < 4} onClick={() => void save()}>
        <Icon name="truck" size={18} /> {busy === 'save' ? 'Adding to PayPal...' : 'Add tracking to the PayPal order'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/* ---------- Camera: product photos -> drafts ---------- */

export interface DraftView {
  id: string;
  name: string;
  description: string;
  image?: string;
  variants: { id: string; title: string; price: string; suggested?: string; inventory: number; madeToOrder: boolean }[];
}

export function PhotoDrafter({ drafts, shared, sharedCount }: { drafts: DraftView[]; shared: boolean; sharedCount: number }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const add = useCallback(async (files: Blob[]) => {
    const next = await Promise.all(files.slice(0, 6).map((f) => shrink(f, 1280)));
    setPhotos((now) => [...now, ...next].slice(0, 6));
  }, []);

  // Photos shared to the installed app (Android's share sheet) wait in the service worker's cache.
  useEffect(() => {
    if (!sharedCount || !('caches' in window)) return;
    (async () => {
      const cache = await caches.open('sayso-share');
      const keys = await cache.keys();
      const blobs = await Promise.all(keys.map(async (k) => (await cache.match(k))!.blob()));
      await Promise.all(keys.map((k) => cache.delete(k)));
      await add(blobs.filter((b) => b.type.startsWith('image/')));
    })().catch(() => setError('Could not read the shared photos; pick them here instead.'));
  }, [sharedCount, add]);

  async function draft() {
    setBusy(true);
    setError(undefined);
    try {
      await callApi('/api/owner/drafts', 'POST', { images: photos, note: note || undefined });
      setPhotos([]);
      setNote('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      {shared ? (
        <div className="empty">
          <b>Not in the shared demo shop.</b>
          <span className="small">Start the judges’ tour for a shop of your own, then add products from your camera there.</span>
        </div>
      ) : (
        <section className="panel stack" style={{ gap: 14 }} aria-label="New photos">
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && void add([...e.target.files])} />
          <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void add([...e.target.files])} />
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-big" disabled={busy || photos.length >= 6} onClick={() => camera.current?.click()}>
              <Icon name="camera" size={20} /> Take a photo
            </button>
            <button className="btn btn-big" disabled={busy || photos.length >= 6} onClick={() => gallery.current?.click()}>
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
          <button className="btn btn-primary" disabled={busy || photos.length === 0} onClick={() => void draft()}>
            {busy ? 'Sayso is looking at your photos...' : `Draft ${photos.length > 1 ? 'products' : 'a product'} from ${photos.length || 'your'} photo${photos.length === 1 ? '' : 's'}`}
          </button>
          {error && <p className="error small">{error}</p>}
          <p className="small muted">Sayso names and describes what it sees and looks up what similar items sell for. Nothing goes on sale until you set the price.</p>
        </section>
      )}

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
  const [busy, setBusy] = useState<'sell' | 'discard'>();
  const [error, setError] = useState<string>();

  async function run(kind: 'sell' | 'discard') {
    setBusy(kind);
    setError(undefined);
    try {
      if (kind === 'sell') {
        await callApi(`/api/owner/drafts/${draft.id}`, 'POST', { name, variants: variants.map((v) => ({ id: v.id, price: v.price, inventory: Number(v.inventory) })) });
        return router.push(`/owner/catalog?added=${encodeURIComponent(name)}`);
      }
      await callApi(`/api/owner/drafts/${draft.id}`, 'DELETE');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(undefined);
    }
  }

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
              <input
                id={`price-${v.id}`}
                inputMode="decimal"
                value={variants[i].price}
                onChange={(e) => setVariants((now) => now.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              />
            </div>
            <div className="field">
              <label htmlFor={`stock-${v.id}`}>{v.madeToOrder ? 'In stock now' : 'Stock'}</label>
              <input
                id={`stock-${v.id}`}
                inputMode="numeric"
                value={variants[i].inventory}
                onChange={(e) => setVariants((now) => now.map((x, j) => (j === i ? { ...x, inventory: e.target.value.replace(/\D/g, '') } : x)))}
              />
            </div>
            {v.suggested && <span className="small muted photo-draft-hint">{v.suggested}</span>}
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void run('sell')}>
            {busy === 'sell' ? 'Putting it on sale...' : 'Put it on sale'}
          </button>
          <button className="btn btn-quiet" disabled={Boolean(busy)} onClick={() => void run('discard')}>
            Discard
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
  );
}
