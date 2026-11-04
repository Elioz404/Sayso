// The owner's say-so: POST { "decision": "approve" | "reject", "note"?: string, "passkey"?: proof }.
// Owner session only (signed cookie). Agent keys are not accepted here, so an agent can never approve
// its own request. Once the shop has a passkey, approving needs `passkey`: the device's signature over
// this request. The shared demo session sees buyers' details masked and can't approve rule changes.
import { PROOF_SCHEMA } from '@/core/passkeys.ts';
import { maskDeep } from '@/core/privacy.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnerSession } from '@/server/http.ts';

const DECISION = {
  type: 'object',
  properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', maxLength: 300 }, passkey: PROOF_SCHEMA },
  required: ['decision'],
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireOwnerSession(request);
    const record = await (await ready()).saySo.record(session.shopId, (await params).id);
    return Response.json(session.kind === 'demo' ? maskDeep(record) : record);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireOwnerSession(request);
    const { decision, note, passkey } = await readBody(request, DECISION);
    const record = await (await ready()).saySo.decide(session.shopId, (await params).id, decision, `owner:${session.shopId}`, { note, proof: passkey, shared: session.kind === 'demo' });
    return Response.json(session.kind === 'demo' ? maskDeep(record) : record);
  });
}
