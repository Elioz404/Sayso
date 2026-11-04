// Sends Web Push messages. The VAPID key pair (which identifies this server to the push services) is
// derived from SAYSO_SECRET, so a deployment needs no extra configuration and keeps the same keys
// across restarts; browsers' subscriptions stay valid as long as the secret does.

import 'server-only';
import { createECDH, createHmac } from 'node:crypto';
import webpush from 'web-push';
import type { PushMessage, PushSender, PushSubscriptionRecord } from '@/core/push.ts';

export interface Vapid {
  publicKey: string;
  privateKey: string;
}

export function vapidFrom(secret: string): Vapid {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(createHmac('sha256', secret).update('sayso:vapid:v1').digest());
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
}

export function webPushSender(vapid: Vapid, subject: string): PushSender {
  // Push services want a contact: a mailto: or an https URL. Local http addresses aren't accepted.
  const contact = subject.startsWith('https://') ? subject : 'mailto:sayso@example.com';
  return async (sub: PushSubscriptionRecord, message: PushMessage) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(message), {
        TTL: 6 * 3600,
        urgency: 'high',
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        vapidDetails: { subject: contact, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        timeout: 8_000,
      });
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw new Error(`push service answered ${status ?? 'nothing'}`);
    }
  };
}
