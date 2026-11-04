// RFC 8414 authorization server metadata: where AI apps register, send the owner to allow them, and trade
// the code for an agent key.
import { serverMetadata } from '@/core/oauth.ts';
import { siteLinks } from '@/server/context.ts';
import { oauthJson, oauthOptions } from '@/server/oauth-route.ts';

export const GET = () => oauthJson(async () => Response.json(serverMetadata(siteLinks())));
export const OPTIONS = oauthOptions;
