// The buyer disconnects their saved PayPal. Only ever reduces what an assistant can do.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const wallet = await (await ready()).wallets.disconnect(id);
    return Response.json({ status: wallet.status });
  });
}
