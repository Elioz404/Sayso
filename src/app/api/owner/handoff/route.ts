// "Continue on your phone": POST { proof? } -> a one-time link (and its QR code) that signs another
// device in to this shop. Only from the device the owner signed in on, and only right after signing
// in or with a passkey confirmation ("phone-link"), so an old stolen session can't keep minting new ones.
import QRCode from 'qrcode';
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';
import { requireStepUp } from '@/server/owner.ts';

const LINK = { type: 'object', properties: { proof: PROOF_SCHEMA } } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireOwnShop(request);
    const { proof } = await readBody(request, LINK);
    const { access, links } = await ready();
    await requireStepUp(session, proof, 'phone-link');
    const url = links.handoff(access.issueHandoff(session, session.expiresAt));
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221c17', light: '#00000000' } });
    return Response.json({ url, qr });
  });
}
