// GET: one record of the shop's Activity as its receipt: who asked, what it did, why it waited, the owner's
// answer and PayPal's read-back, as it stands now. `passkey`: approving it needs the owner's passkey.
import { HttpError } from '@/core/errors.ts';
import { handle, requireOwnerSession } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';
import { recordView } from '@/core/record-view.ts';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireOwnerSession(request);
    const view = await ownerView();
    if (!view) throw new HttpError(401, 'Sign in as the shop owner first');
    const record = await view.saySo.record(view.shopId, (await params).id);
    const [passkey, signed] = await Promise.all([view.passkeys.required(view.shopId), view.passkeys.checkApproval(record)]);
    return Response.json({ record: recordView(record, view.redact, signed), passkey });
  });
}
