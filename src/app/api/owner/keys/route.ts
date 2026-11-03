// Agent keys for the owner's own agents. POST { "label" } issues one (shown once);
// DELETE { "id" } revokes it immediately.
import { HttpError, notFound } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { label } = await readJson<{ label?: string }>(request);
    const { access, links } = await ready();
    const { key, secret } = await access.createAgentKey(shopId, label?.trim() || 'my agent');
    return Response.json({ id: key.id, label: key.label, key: secret, mcp_url: links.sellerMcpFor(secret), cli_login: links.cliLogin(secret) }, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await readJson<{ id?: string }>(request);
    if (!id) throw new HttpError(400, 'id is required');
    const { access } = await ready();
    // Everyone trying the hosted demo shares its seeded agent key; revoking it would lock the next visitor out.
    const shared = process.env.SAYSO_DEMO_AGENT_KEY;
    if (shared && (await access.isKey(shopId, id, shared))) throw new HttpError(403, 'This key is shared with everyone trying the demo, so it stays. Revoke any key you made.');
    if (!(await access.revokeKey(shopId, id))) throw notFound(`Key ${id}`);
    return Response.json({ ok: true });
  });
}
