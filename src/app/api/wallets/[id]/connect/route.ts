// The buyer chose limits: save them and return the PayPal approval link for saving their PayPal. This
// browser becomes the wallet's holder: only it can finish the connection and see or disconnect it.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { limitPayPal } from '@/server/rate-limit.ts';
import { rememberWallet } from '@/server/wallet-session.ts';

const LIMITS = { type: 'object', properties: { perOrder: { type: 'string', maxLength: 20 }, daily: { type: 'string', maxLength: 20 } }, required: ['perOrder', 'daily'] } as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    limitPayPal(request);
    const { perOrder, daily } = await readBody(request, LIMITS);
    const url = await (await ready()).wallets.startConnect(id, { perOrder, daily });
    await rememberWallet(id);
    return Response.json({ url });
  });
}
