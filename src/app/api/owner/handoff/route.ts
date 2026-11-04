// "Continue on your phone": POST { proof? } -> a one-time link (and its QR code) that signs another
// device in to this shop. Only from the device the owner signed in on, and only right after signing
// in or with a passkey confirmation ("phone-link"), so an old stolen session can't keep minting new ones.
import QRCode from 'qrcode';
import { HttpError } from '@/core/errors.ts';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

const LINK = { type: 'object', properties: { proof: PROOF_SCHEMA } } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireOwnShop(request);
    const { proof } = await readBody(request, LINK);
    const { access, passkeys, links } = await ready();
    if (session.via === 'handoff') throw new HttpError(403, 'Show the code from the device you signed in on.');
    if (proof) await passkeys.confirm(session.shopId, 'phone-link', proof);
    else if (!access.isFresh(session)) throw new HttpError(403, 'For your safety, the phone code shows for 30 minutes after you sign in. Sign in again, or confirm with your passkey.');
    const url = links.handoff(access.issueHandoff(session, session.expiresAt));
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221c17', light: '#00000000' } });
    return Response.json({ url, qr });
  });
}
