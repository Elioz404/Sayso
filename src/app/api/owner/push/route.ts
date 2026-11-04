// Notifications on this device: POST { subscription, label } after PushManager.subscribe(), DELETE
// { endpoint } to turn them off. Owner session only, never the shared demo.
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const { subscription, label } = await readJson<{ subscription?: unknown; label?: string }>(request);
    const saved = await (await ready()).push.subscribe(shopId, subscription, typeof label === 'string' ? label : '');
    return Response.json({ id: saved.id, label: saved.label });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const { endpoint } = await readJson<{ endpoint?: string }>(request);
    if (typeof endpoint === 'string') await (await ready()).push.unsubscribe(shopId, endpoint);
    return Response.json({ ok: true });
  });
}
