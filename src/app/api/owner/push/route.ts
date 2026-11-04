// Notifications on this device: POST { subscription, label } after PushManager.subscribe(), DELETE
// { endpoint } to turn them off. The owner's own shop only, never the shared demo.
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const ENDPOINT = { type: 'string', maxLength: 1_000 } as const;
const SUBSCRIBE = {
  type: 'object',
  properties: {
    subscription: {
      type: 'object',
      properties: { endpoint: ENDPOINT, keys: { type: 'object', properties: { p256dh: { type: 'string', maxLength: 200 }, auth: { type: 'string', maxLength: 100 } }, required: ['p256dh', 'auth'] } },
      required: ['endpoint', 'keys'],
    },
    label: { type: 'string', maxLength: 40 },
  },
  required: ['subscription'],
} as const;
const UNSUBSCRIBE = { type: 'object', properties: { endpoint: ENDPOINT }, required: ['endpoint'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { subscription, label } = await readBody(request, SUBSCRIBE);
    const saved = await (await ready()).push.subscribe(shopId, subscription, label ?? '');
    return Response.json({ id: saved.id, label: saved.label });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { endpoint } = await readBody(request, UNSUBSCRIBE);
    await (await ready()).push.unsubscribe(shopId, endpoint);
    return Response.json({ ok: true });
  });
}
