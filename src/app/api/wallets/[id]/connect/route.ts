// The buyer chose limits: save them and return the PayPal approval link for saving their PayPal.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readJson } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { perOrder, daily } = await readJson<{ perOrder?: string; daily?: string }>(request);
    const url = await (await ready()).wallets.startConnect(id, { perOrder: String(perOrder ?? ''), daily: String(daily ?? '') });
    return Response.json({ url });
  });
}
