// "Continue on your phone": the QR code on /owner/phone opens this link, which signs the phone in to
// the same shop and lands on the phone setup. The link is signed and lasts ten minutes; approvals
// still need the owner's passkey once the shop has one.
import { ready } from '@/server/context.ts';
import { HANDOFF_PURPOSE, startOwnerSession } from '@/server/http.ts';

const WEEK_MS = 7 * 86_400_000;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { access, links } = await ready();
  const shopId = access.verifyValue(HANDOFF_PURPOSE, decodeURIComponent((await params).token));
  if (!shopId) return Response.redirect(`${links.base}/owner/phone?handoff=expired`, 303);
  await startOwnerSession(shopId, 'owner', new Date(Date.now() + WEEK_MS));
  return Response.redirect(`${links.base}/owner/phone?handoff=1`, 303);
}
