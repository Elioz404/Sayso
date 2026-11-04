// Shop with an AI assistant: the buyer's side of Sayso, tried in the browser. The same buyer tools are on
// the public MCP endpoint for anyone who would rather use their own assistant.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { ShopperChat } from '@/app/_components/shopper-chat.tsx';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Shop with an AI assistant' };

export default async function AssistantPage() {
  await connection();
  const { links } = await ready();
  return (
    <main className="wrap page shopper-page">
      <div className="stack" style={{ gap: 'var(--s5)', minWidth: 0 }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h1>Shop with an AI assistant</h1>
          <p className="soft">
            This is the buyer&apos;s side: an assistant that can buy from small shops. It uses the same tools any AI assistant gets from Sayso&apos;s MCP server, and the
            shop, not the AI, prices every cart.
          </p>
        </div>
        <ShopperChat />
      </div>
      <aside className="panel stack shopper-side">
        <h2>Use your own assistant</h2>
        <p className="small soft">Add Sayso to ChatGPT, Cursor or any MCP client as a connector. No key needed for shopping.</p>
        <CopyField value={links.shoppingMcp} />
        <ol className="small soft shopper-steps">
          <li>In ChatGPT: Settings, Apps (Connectors or Plugins in some versions), then create a custom MCP connector.</li>
          <li>Name it Sayso, choose No authentication, paste this URL, tick that you trust it and press Create.</li>
          <li>In a new chat: &ldquo;Use Sayso to find me a handmade mug under $40.&rdquo;</li>
        </ol>
        <a className="small" href="/docs#chatgpt">Step by step, in the docs</a>
        <p className="small muted">Shop owners get their own MCP URL, with a key, under Agents. Their agent can run the shop, but money and rule changes wait for the owner.</p>
      </aside>
    </main>
  );
}
