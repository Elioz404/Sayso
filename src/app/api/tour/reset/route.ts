// POST: For Judges, from the start in this browser. It forgets the orders paid here, the steps opened, the
// draft in progress, and signs out of the judge's shop and of PayPal here. Nothing is deleted: orders stay
// with their shops, and a shop opened from For Judges still closes after two days.
import { cookies } from 'next/headers';
import { SEEN_COOKIE } from '@/app/_components/judges-seen.ts';
import { endBuyerSession, forgetPaidHere } from '@/server/buyer-session.ts';
import { assertSameOrigin, handle, OWNER_COOKIE } from '@/server/http.ts';
import { endSellerSession, forgetClaim, forgetPublish } from '@/server/seller-session.ts';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await Promise.all([forgetPaidHere(), endBuyerSession(), endSellerSession(), forgetClaim(), forgetPublish()]);
    const jar = await cookies();
    jar.delete(OWNER_COOKIE);
    jar.delete(SEEN_COOKIE);
    return Response.json({ ok: true });
  });
}
