// The owner's say-so: POST { "decision": "approve" | "reject", "note"?: string }.
// Owner session only (signed cookie). Agent keys are not accepted here, so an agent can never
// approve its own request.
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await params;
    return Response.json(await (await ready()).saySo.record(shopId, id));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await params;
    const { decision, note } = await readJson<{ decision: 'approve' | 'reject'; note?: string }>(request);
    if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, 'decision must be "approve" or "reject"');
    const record = await (await ready()).saySo.decide(shopId, id, decision, `owner:${shopId}`, note?.slice(0, 300));
    return Response.json(record);
  });
}
