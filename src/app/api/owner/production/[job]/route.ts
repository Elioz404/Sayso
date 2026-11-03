// The owner moves a job on the made-to-order board: PATCH { "start": "2026-11-20", "end": "2026-12-02" }.
// Same service as the agent's plan_job tool. Plans only; payments stay as PayPal reports them.
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function PATCH(request: Request, { params }: { params: Promise<{ job: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { job } = await params;
    const { start, end } = await readJson<{ start?: string; end?: string }>(request);
    const planned = await (await ready()).production.plan(shopId, decodeURIComponent(job), { start: String(start ?? ''), end: String(end ?? '') });
    return Response.json(planned);
  });
}
