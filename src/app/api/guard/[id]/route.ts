// The owner's say-so: POST { "decision": "approve" | "reject", "note"?: string }.
// Owner session only (signed cookie). Agent keys are not accepted here, so an agent can never
// approve its own request.
import { HttpError } from '@/core/commerce.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await params;
    const record = await (await ready()).guardStore.get(id);
    if (!record || record.action.ownerId !== shopId) throw new HttpError(404, `No say-so request ${id}`);
    return Response.json(record);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await params;
    const { decision, note } = await readJson<{ decision: 'approve' | 'reject'; note?: string }>(request);
    if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'decision must be "approve" or "reject"');
    const record = await (await ready()).seller.decide(shopId, id, decision, `owner:${shopId}`, note?.slice(0, 300));
    return Response.json(record);
  });
}
