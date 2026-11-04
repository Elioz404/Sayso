// RFC 9728 protected resource metadata for the seller MCP endpoint (/api/mcp): which authorization server
// signs agents in. Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
import { resourceMetadata } from '@/core/oauth.ts';
import { siteLinks } from '@/server/context.ts';
import { oauthJson, oauthOptions } from '@/server/oauth-route.ts';

export const GET = () => oauthJson(async () => Response.json(resourceMetadata(siteLinks())));
export const OPTIONS = oauthOptions;
