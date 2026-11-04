// Where an AI app sends the owner to allow it (OAuth authorization endpoint). A good request goes on to the
// consent page under a path of its own, so it survives signing in; a bad app or address is explained here,
// and other mistakes go back to the app.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { checkAuthorize, OAuthError, packRequest } from '@/core/oauth.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Connect an AI app', robots: { index: false } };

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') params.set(k, v);
  const { access, links } = await ready();
  let target: string;
  try {
    const checked = checkAuthorize(access, links, params);
    target = 'redirect' in checked ? checked.redirect : `/oauth/consent/${packRequest(access, checked.request)}`;
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>This connection can&apos;t continue</h1>
        <p className="soft">{err.message}</p>
        <a href="/owner/agents">Your agents</a>
      </main>
    );
  }
  redirect(target);
}
