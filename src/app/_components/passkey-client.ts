'use client';

// The browser side of passkeys: turn Sayso's options into WebAuthn calls and the answers back into
// JSON. Challenges are fetched before the owner taps (browsers only open the fingerprint/face prompt
// straight from a tap) and refreshed while the page is visible, before the server's five minutes run out.

import { useCallback, useEffect, useState } from 'react';
import type { Challenge, Confirmation, PasskeyProof } from '@/core/passkeys.ts';
import { callApi } from './api.ts';

export type { PasskeyProof };

/** What to fetch a challenge for. */
export type ChallengeRequest = { purpose: 'register' } | { purpose: 'approve'; record: string } | { purpose: 'confirm'; what: Confirmation };

type Descriptor = { id: string; type: 'public-key'; transports?: string[] };

/** The options Sayso's server sends (src/core/passkeys.ts), with binary fields as base64url. */
interface CreationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  excludeCredentials?: Descriptor[];
  timeout: number;
}
interface RequestOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: Descriptor[];
  userVerification: UserVerificationRequirement;
  timeout: number;
}

export function fromB64url(value: string): ArrayBuffer {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toB64url(buffer: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(buffer)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const withIds = (list?: Descriptor[]): PublicKeyCredentialDescriptor[] | undefined =>
  list?.map((c) => ({ type: c.type, id: fromB64url(c.id), transports: c.transports as AuthenticatorTransport[] | undefined }));

function passkeyError(err: unknown): Error {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return new Error('Cancelled, or the passkey prompt timed out. Try again.');
  if (name === 'InvalidStateError') return new Error('This device already has a passkey for this shop.');
  if (name === 'SecurityError') return new Error('Passkeys only work on the shop’s real address (https).');
  return err instanceof Error ? err : new Error('The passkey did not work on this device');
}

/** Sign a prefetched challenge with one of the shop's passkeys. Call straight from a tap. */
export async function signChallenge(challenge: Challenge): Promise<PasskeyProof> {
  const o = challenge.options as unknown as RequestOptions;
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.get({
      publicKey: { challenge: fromB64url(o.challenge), rpId: o.rpId, allowCredentials: withIds(o.allowCredentials), userVerification: o.userVerification, timeout: o.timeout },
    })) as PublicKeyCredential;
  } catch (err) {
    throw passkeyError(err);
  }
  const r = credential.response as AuthenticatorAssertionResponse;
  return { token: challenge.token, credential: { id: credential.id, clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature) } };
}

/** Make a passkey on this device from a prefetched registration challenge, and save it. */
export async function makePasskey(challenge: Challenge, label: string, proof?: PasskeyProof): Promise<void> {
  const o = challenge.options as unknown as CreationOptions;
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: fromB64url(o.challenge),
        rp: o.rp,
        user: { ...o.user, id: fromB64url(o.user.id) },
        pubKeyCredParams: o.pubKeyCredParams,
        authenticatorSelection: o.authenticatorSelection,
        attestation: o.attestation,
        excludeCredentials: withIds(o.excludeCredentials),
        timeout: o.timeout,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    throw passkeyError(err);
  }
  const r = credential.response as AuthenticatorAttestationResponse;
  await callApi('/api/owner/passkeys', 'POST', {
    token: challenge.token,
    label,
    proof,
    credential: { id: credential.id, clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject), transports: r.getTransports?.() ?? [] },
  });
}

/** A challenge fetched ahead of the tap. Pass undefined to fetch nothing. */
export function usePasskeyChallenge(request: ChallengeRequest | undefined) {
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const key = request ? JSON.stringify(request) : '';
  const load = useCallback(async () => {
    if (!key) return setChallenge(undefined);
    try {
      setChallenge(await callApi<Challenge>('/api/owner/passkeys/options', 'POST', JSON.parse(key)));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [key]);
  useEffect(() => {
    void load();
    // Refresh before the server's five minutes run out, but only while someone is looking.
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 4 * 60_000);
    const onShow = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [load]);
  return { challenge, error, reload: load };
}
