// The owner on the made-to-order board. Same service as the agent's plan_job and finish_job tools;
// plans and "made" only, payments stay as PayPal reports them.
//   PATCH { "start": "2026-11-20", "end": "2026-12-02" }  plan when the job is made
//   POST                                                  the job is made: take it off the board
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

type Params = { params: Promise<{ job: string }> };

const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const PLAN = { type: 'object', properties: { start: DAY, end: DAY }, required: ['start', 'end'] } as const;

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { job } = await params;
    const { start, end } = await readBody(request, PLAN);
    return Response.json(await (await ready()).production.plan(shopId, decodeURIComponent(job), { start, end }));
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { job } = await params;
    return Response.json(await (await ready()).production.finish(shopId, decodeURIComponent(job)));
  });
}
