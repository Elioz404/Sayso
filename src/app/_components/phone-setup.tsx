'use client';

// The steps that put a shop on the owner's phone: put it on the home screen, turn on notifications, and
// add a passkey so every OK is signed by this device. Managing passkeys needs a recent sign-in, or (once
// the shop has one) a passkey confirmation of that exact change.
//
// Installing is only needed on iPhone (Safari sends notifications to home-screen apps only). On Android
// everything works in the browser, and installing is offered only in Chrome: other Android browsers
// package the app themselves for an old Android version, and Play Protect warns it is unsafe.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { callApi } from './api.ts';
import { fromB64url, makePasskey, signChallenge, usePasskeyChallenge } from './passkey-client.ts';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';
import { ErrorText } from './error-text.tsx';
import { Day } from './time.tsx';

export interface PasskeyRowView {
  id: string;
  label: string;
  /** When it was added and last used (ISO). */
  added: string;
  used?: string;
  synced: boolean;
}

interface BeforeInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type PushState = 'checking' | 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked';

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

/** Android browsers that aren't Chrome, by how they name themselves. In-app browsers can't install at all. */
const OTHER_ANDROID_BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser/, 'Samsung Internet'],
  [/EdgA\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/YaBrowser/, 'Yandex Browser'],
  [/DuckDuckGo/, 'DuckDuckGo'],
  [/FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/, 'an in-app browser'],
];

/** On Android: whether this is Chrome itself, and what to call it if not. */
function androidBrowser(): { android: boolean; chrome: boolean; name?: string } {
  const ua = navigator.userAgent;
  if (!/Android/.test(ua)) return { android: false, chrome: false };
  const other = OTHER_ANDROID_BROWSERS.find(([re]) => re.test(ua))?.[1] ?? ((navigator as { brave?: unknown }).brave ? 'Brave' : undefined);
  return { android: true, chrome: !other && /Chrome\//.test(ua), name: other };
}
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return isIos() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

function Step({ n, done, optional = false }: { n: number; done: boolean; optional?: boolean }) {
  return <span className={`phone-step${done ? ' phone-step-done' : ''}${optional && !done ? ' phone-step-optional' : ''}`}>{done ? <Icon name="check" size={16} /> : optional ? <Icon name="plus" size={16} /> : n}</span>;
}

export function PhoneSetup({ pushKey, passkeys, devices, fresh }: { pushKey: string; passkeys: PasskeyRowView[]; devices: string[]; fresh: boolean }) {
  const router = useRouter();
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [android, setAndroid] = useState<ReturnType<typeof androidBrowser>>({ android: false, chrome: false });
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt>();
  const [push, setPush] = useState<PushState>('checking');
  const [canPasskey, setCanPasskey] = useState<boolean>();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string>();
  const [addProof, setAddProof] = useState<Awaited<ReturnType<typeof signChallenge>>>();
  const { busy, error, run } = useAction();
  const hasPasskey = passkeys.length > 0;
  const register = usePasskeyChallenge({ purpose: 'register' });
  // Adding another passkey without a recent sign-in: confirm with one the shop has.
  const confirmAdd = usePasskeyChallenge(hasPasskey && !fresh ? { purpose: 'confirm', what: 'add-passkey' } : undefined);

  useEffect(() => {
    setInstalled(isInstalled());
    setIos(isIos());
    setAndroid(androidBrowser());
    setLabel(deviceLabel());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Called on PublicKeyCredential itself: detached, browsers throw "Illegal invocation".
    if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setCanPasskey, () => setCanPasskey(false));
    } else setCanPasskey(false);
    pushState().then(setPush, () => setPush('unsupported'));
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  /** Run an action, show its outcome, and refresh the server-rendered lists. */
  const act = (name: string, fn: () => Promise<string>) =>
    run(async () => {
      setNote(undefined);
      setNote(await fn());
      router.refresh();
    }, name);

  const turnOnPush = () =>
    act('push', async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'blocked' : 'off');
        throw new Error('Notifications were not allowed. You can allow them in this browser’s site settings.');
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(pushKey) }));
      await callApi('/api/owner/push', 'POST', { subscription: sub.toJSON(), label: deviceLabel() });
      setPush('on');
      await callApi('/api/owner/push/test', 'POST');
      return 'Notifications are on. A test one is on its way.';
    });

  const turnOffPush = () =>
    act('push', async () => {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await callApi('/api/owner/push', 'DELETE', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPush('off');
      return 'Notifications are off on this device.';
    });

  const confirmFirst = () =>
    act('confirm', async () => {
      if (!confirmAdd.challenge) throw new Error(confirmAdd.error ?? 'Getting ready, try again in a second');
      setAddProof(await signChallenge(confirmAdd.challenge));
      return 'Confirmed. Now make the new passkey on this device.';
    });

  const addPasskey = () =>
    act('passkey', async () => {
      if (!register.challenge) throw new Error(register.error ?? 'Getting ready, try again in a second');
      await makePasskey(register.challenge, label || deviceLabel(), addProof);
      setAddProof(undefined);
      await register.reload();
      return 'Passkey saved. From now on, every OK is signed by your fingerprint, face or PIN.';
    });

  const needsConfirm = hasPasskey && !fresh && !addProof;

  // On Android installing is optional, so it goes last and the steps that matter are numbered first.
  const optionalInstall = android.android;
  const first = optionalInstall ? 0 : 1;
  const installCard = (
    <section className="phone-card" aria-labelledby="install">
      <Step n={1} done={installed} optional={optionalInstall} />
      <div className="phone-card-body">
        <h2 id="install">{android.android && !installed ? 'Optional: an icon on your home screen' : 'Put Sayso on your home screen'}</h2>
        {installed ? (
          <p className="soft">Installed. Sayso opens full screen, straight on your shop.</p>
        ) : android.android && !android.chrome ? (
          <p className="soft">
            You don’t need it: on Android, notifications and your fingerprint work right here. Want the icon anyway? Scan the code again with <b>Chrome</b> and install from there.
            Installing from {android.name ?? 'this browser'} makes Android warn that the app is unsafe, because that browser packages it for an old Android version.
          </p>
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
        ) : android.android ? (
          <p className="soft">
            You don’t need it: notifications and your fingerprint work right here. For the icon, use Chrome’s menu (⋮) and <b>Install app</b>.
          </p>
        ) : (
          <p className="soft">
            Open this page on your phone. On iPhone, Sayso needs to be on the home screen to send notifications; on Android it works in Chrome as it is.
          </p>
        )}
      </div>
    </section>
  );

  return (
    <div className="phone-setup">
      {!optionalInstall && installCard}
      <section className="phone-card" aria-labelledby="notify">
        <Step n={first + 1} done={push === 'on'} />
        <div className="phone-card-body">
          <h2 id="notify">Get a ping when your agent needs you</h2>
          <p className="soft">When an agent’s request waits for your say-so, and when an order is paid. Tap it and you’re on the decision.</p>
          {push === 'on' ? (
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
          ) : (
            <p className="small soft">
              {
                {
                  checking: 'Checking this browser...',
                  'needs-install': 'On iPhone, notifications work once Sayso is on your home screen (step 1). Open it from there and come back to this step.',
                  blocked: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.',
                  unsupported: 'This browser can’t receive notifications. Chrome, Edge, Firefox and Safari (from your home screen) can.',
                }[push]
              }
            </p>
          )}
          {devices.length > 0 && <p className="small muted">Notifying: {devices.join(', ')}</p>}
        </div>
      </section>

      <section className="phone-card" aria-labelledby="passkey">
        <Step n={first + 2} done={hasPasskey} />
        <div className="phone-card-body">
          <h2 id="passkey">Approve with your fingerprint or face</h2>
          <p className="soft">
            With a passkey, no one can say OK for you: not someone holding your unlocked phone, not a stolen login, not an agent. Each OK is signed by this device over the exact request, and the signature
            is kept in the audit trail.
          </p>
          {hasPasskey && (
            <ul className="list list-tight">
              {passkeys.map((k) => (
                <PasskeyRow key={k.id} passkey={k} fresh={fresh} onRemoved={() => router.refresh()} />
              ))}
            </ul>
          )}
          {canPasskey === false ? (
            <p className="small soft">This browser can’t make a passkey. Phones with a fingerprint, face unlock or screen lock can.</p>
          ) : !hasPasskey && !fresh ? (
            <p className="small soft">For your safety, the first passkey is added within 30 minutes of signing in. Sign out and in again, then come back here.</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="field">
                <label htmlFor="passkey-label">Name this device</label>
                <input id="passkey-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="My iPhone" />
              </div>
              {needsConfirm ? (
                <button className="btn" disabled={Boolean(busy) || !confirmAdd.challenge} onClick={() => void confirmFirst()}>
                  <Icon name="fingerprint" size={18} /> {busy === 'confirm' ? 'Waiting for your passkey...' : 'Add another: confirm with a passkey you have'}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={Boolean(busy) || !register.challenge} onClick={() => void addPasskey()}>
                  <Icon name="fingerprint" size={18} /> {busy === 'passkey' ? 'Waiting for your device...' : hasPasskey ? 'Make the new passkey' : 'Set up a passkey'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {optionalInstall && installCard}

      {(error || note) && (
        <p className={error ? 'error' : 'ok-note'} role="status">
          {error ?? note}
        </p>
      )}
    </div>
  );
}

/** One passkey. Removing it right after signing in is one tap; otherwise it is confirmed with a passkey. */
function PasskeyRow({ passkey, fresh, onRemoved }: { passkey: PasskeyRowView; fresh: boolean; onRemoved: () => void }) {
  const [armed, setArmed] = useState(false);
  const { busy, error, run } = useAction();
  const confirm = usePasskeyChallenge(armed && !fresh ? { purpose: 'confirm', what: `remove-passkey:${passkey.id}` } : undefined);

  const remove = () =>
    run(async () => {
      const proof = fresh ? undefined : confirm.challenge ? await signChallenge(confirm.challenge) : undefined;
      if (!fresh && !proof) throw new Error(confirm.error ?? 'Getting ready, try again in a second');
      await callApi(`/api/owner/passkeys/${encodeURIComponent(passkey.id)}`, 'DELETE', { proof });
      onRemoved();
    });

  return (
    <li className="spread">
      <span className="stack" style={{ gap: 2 }}>
        <b>
          <Icon name="fingerprint" size={16} /> {passkey.label}
        </b>
        <span className="small muted">
          Added <Day iso={passkey.added} />
          {passkey.used && (
            <>
              {' · last OK '}
              <Day iso={passkey.used} />
            </>
          )}
          {passkey.synced ? ' · synced with your account' : ''}
        </span>
        <ErrorText inline>{error}</ErrorText>
      </span>
      {fresh || armed ? (
        <button className="btn btn-quiet btn-small" disabled={Boolean(busy) || (!fresh && !confirm.challenge)} onClick={() => void remove()}>
          {busy ? 'Removing...' : fresh ? 'Remove' : 'Confirm removal'}
        </button>
      ) : (
        <button className="btn btn-quiet btn-small" onClick={() => setArmed(true)}>
          Remove
        </button>
      )}
    </li>
  );
}
