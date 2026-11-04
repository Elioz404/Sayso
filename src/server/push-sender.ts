// Sends Web Push messages. The VAPID key pair (which identifies this server to the push services) is
// derived from a secret: SAYSO_PUSH_SECRET when set, else SAYSO_SECRET, so a deployment needs no extra
// configuration and keeps the same keys across restarts. Browsers' subscriptions stay valid as long as
// that secret does; set SAYSO_PUSH_SECRET to rotate the session secret without losing them.

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

/**
 * A sender, or undefined when the server has no contact push services accept (a mailto: or an https
 * URL): SAYSO_PUSH_CONTACT, else the site's own https address. Plain-http local runs send no pushes.
 */
export function webPushSender(vapid: Vapid, siteUrl: string, contact = process.env.SAYSO_PUSH_CONTACT): PushSender | undefined {
  const subject = contact?.startsWith('mailto:') || contact?.startsWith('https://') ? contact : siteUrl.startsWith('https://') ? siteUrl : undefined;
  if (!subject) return undefined;
  return async (sub: PushSubscriptionRecord, message: PushMessage) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(message), {
        TTL: 6 * 3600,
        urgency: 'high',
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
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
