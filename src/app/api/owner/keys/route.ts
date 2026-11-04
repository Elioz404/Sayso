// Agent keys for the owner's own agents. POST { "label" } issues one (shown once); DELETE { "id" }
// revokes it immediately. Not in the shared demo session: everyone trying the demo uses its one
// shared key, which sees buyers' details masked.
import { notFound } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const NEW_KEY = { type: 'object', properties: { label: { type: 'string', maxLength: 60 } } } as const;
const REVOKE = { type: 'object', properties: { id: { type: 'string', maxLength: 40 } }, required: ['id'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { label } = await readBody(request, NEW_KEY);
    const { access, links } = await ready();
    const { key, secret } = await access.createAgentKey(shopId, label?.trim() || 'my agent');
    return Response.json({ id: key.id, label: key.label, key: secret, mcp_url: links.sellerMcpFor(secret), cli_login: links.cliLogin(secret) }, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { id } = await readBody(request, REVOKE);
    const { access } = await ready();
    if (!(await access.revokeKey(shopId, id))) throw notFound(`Key ${id}`);
    return Response.json({ ok: true });
  });
}
