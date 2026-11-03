// The owner's say-so: POST { "decision": "approve" | "reject", "note"?: string }.
// TODO(day 5): require the owner's session; for the sandbox demo the dashboard is the only caller.
import { ctx } from '@/server/context.ts';
import { handle, readJson } from '@/server/http.ts';
import { HttpError } from '@/core/commerce.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const record = await ctx().guardStore.get(id);
    if (!record) throw new HttpError(404, `No Guard record ${id}`);
    return Response.json(record);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { decision, note } = await readJson<{ decision: 'approve' | 'reject'; note?: string }>(request);
    const owner = 'owner:maya';
    if (decision === 'approve') return Response.json(await ctx().guard.approve(id, owner));
    if (decision === 'reject') return Response.json(await ctx().guard.reject(id, owner, note));
    throw new HttpError(400, 'decision must be "approve" or "reject"');
  });
}
