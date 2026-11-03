// Agent keys for the owner's own agents. POST { "label" } issues one (shown once);
// DELETE { "id" } revokes it immediately.
import { HttpError } from '@/core/commerce.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { label } = await readJson<{ label?: string }>(request);
    const { key, secret } = await (await ready()).access.createAgentKey(shopId, label?.trim() || 'my agent');
    return Response.json({ id: key.id, label: key.label, key: secret }, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await readJson<{ id?: string }>(request);
    if (!id) throw new HttpError(400, 'id is required');
    await (await ready()).access.revokeKey(shopId, id).catch(() => {
      throw new HttpError(404, `No key ${id}`);
    });
    return Response.json({ ok: true });
  });
}
