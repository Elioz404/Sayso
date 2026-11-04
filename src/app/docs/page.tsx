// Task-first docs for people on the site: shop from an assistant, let it pay, run a shop with an agent.
// Every URL is built from this server's public address, so the deployed page shows the real ones.
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { ABOUT } from '@/core/about.ts';
import { MCP_VERSIONS } from '@/core/mcp.ts';
import { developerPortalBuilt, paypalLoginEnabled, siteLinks } from '@/server/context.ts';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Shop on Sayso or from ChatGPT or any MCP client, let your assistant pay inside your limits, and run a shop with your own agent.',
};

const SECTIONS = [
  { id: 'buy', title: 'Shop on Sayso' },
  { id: 'shop', title: 'Shop from your assistant' },
  { id: 'pay', title: 'Pay without a link each time' },
  { id: 'run', title: 'Run your shop with your agent' },
  { id: 'paid', title: 'Get paid into your PayPal' },
  { id: 'cli', title: 'The sayso CLI' },
  { id: 'guard', title: 'How your money is protected' },
  { id: 'paypal', title: "PayPal's commerce platform" },
  { id: 'reference', title: 'Reference' },
];

const CLI = [
  ['sayso status', 'Orders, what is waiting for you, low stock, what shoppers could not get'],
  ['sayso orders', 'Recent orders; sayso order SAY-... for one'],
  ['sayso refund SAY-... 10.00 --reason "..."', 'Refund through your rules'],
  ['sayso track SAY-... USPS 9400...', 'Add shipment tracking in PayPal'],
  ['sayso invoice <email> "Custom vase" 62.00 --deposit 31.00', 'Invoice a custom order through PayPal'],
  ['sayso invoices', 'Invoices with their live status'],
  ['sayso price <variant> 38.00', 'Change a price'],
  ['sayso stock <variant> 4', 'Set stock'],
  ['sayso approvals', "What is waiting for you (read-only)"],
  ['sayso policy propose "..."', 'Draft new rules; they apply after you approve'],
  ['sayso policy earned', 'Rules your own approvals support, with the decisions behind them'],
  ['sayso audit', 'Every money move with its hash-chain check'],
  ['sayso mcp', 'Serve the tools to a local MCP client over stdio'],
];

export default async function Docs() {
  await connection(); // URLs come from PUBLIC_BASE_URL at request time, not at build time
  const links = siteLinks();
  const portal = developerPortalBuilt();
  const paypalLogin = paypalLoginEnabled();
  return (
    <main className="wrap page">
      <div className="docs">
        <aside className="toc" aria-label="On this page">
          <b className="small">On this page</b>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="docs-body">
          <header className="stack" style={{ gap: 'var(--s3)' }}>
            <h1>Sayso docs</h1>
            <p className="lede">
              Sayso connects small shops to shoppers and their AI assistants through PayPal. Shoppers buy on the site or from their own assistant, the
              shop owner&apos;s own agent runs the shop, and money only moves inside the rules each person set.
            </p>
            <p className="small muted">This demo runs on the PayPal sandbox. No real money moves.</p>
          </header>

          <section id="buy" className="doc-section">
            <h2>Shop on Sayso</h2>
            <p>No account and nothing to install: PayPal knows who you are when you pay.</p>
            <ol className="steps">
              <li>
                <span>
                  Open <a href="/shops">Shops</a> and pick one, or tap <b>Ask AI to shop</b> at the bottom right. Sayso&apos;s assistant searches every
                  shop and shows what it finds with photos and links; it only shops at Sayso.
                </span>
              </li>
              <li>
                <span>
                  Add pieces to the cart, or let the assistant build it. Each shop has its own cart, because each shop prices it (shipping and tax
                  included) and is paid on its own.
                </span>
              </li>
              <li>
                <span>
                  Pay with PayPal&apos;s button, right in the cart or the chat. Nothing is charged until you approve, and you can cancel a cart the
                  assistant made.
                </span>
              </li>
              <li>
                <span>
                  Every order gets its own page: where it is (paid, preparing, shipped, with the parcel&apos;s tracking) and its refunds, with a QR code
                  and a link to open it on your phone. To ask for a refund, the assistant takes your reason to the shop and the owner decides; only the
                  buyer can ask (from the browser that paid, or signed in with that PayPal), so a shared link only shows the order. Your receipt links
                  to the page, and the panel&apos;s <b>Orders</b> tab lists your orders wherever you are on the site.
                </span>
              </li>
              <li>
                <span>
                  On another phone or computer, open <a href="/orders">My orders</a> and sign in with the PayPal account you paid with. There&apos;s no
                  Sayso account: PayPal tells Sayso who you are, and you see every order that account paid for, in every shop.
                </span>
              </li>
            </ol>
          </section>

          <section id="shop" className="doc-section">
            <h2>Shop from your assistant</h2>
            <p>One MCP server covers every shop on Sayso. No account or key needed.</p>
            <CopyField value={links.shoppingMcp} />
            <ol className="steps">
              <li>
                <span>
                  Add it as a connector in your assistant: in ChatGPT, follow <a href="#chatgpt">the steps below</a>; in any other MCP client, add a
                  remote server with this URL.
                </span>
              </li>
              <li>
                <span>Ask for what you want, for example &ldquo;a green hand-thrown mug, shipped to Austin&rdquo;.</span>
              </li>
              <li>
                <span>
                  Your assistant builds the cart with the shop&apos;s real prices, shipping and tax. ChatGPT shows it as a card with a <b>Pay with PayPal</b>{' '}
                  button; other clients give you a PayPal link. You approve in PayPal.
                </span>
              </li>
              <li>
                <span>
                  Later, ask &ldquo;where is my order?&rdquo; or &ldquo;it arrived broken, ask for a refund&rdquo;. Refund requests go to the shop owner,
                  who decides.
                </span>
              </li>
            </ol>
          </section>

          <section id="chatgpt" className="doc-section">
            <h2>Add Sayso to ChatGPT</h2>
            <p>About a minute, once. After that any chat can shop at Sayso&apos;s shops.</p>
            <ol className="steps">
              <li>
                <span>
                  In ChatGPT, open <b>Settings</b>, then <b>Apps</b> (called Connectors or Plugins in some versions and languages). Turn on{' '}
                  <b>Developer mode</b> under Advanced if it asks, then choose <b>Create</b> or <b>Add</b> a custom MCP connector.
                </span>
              </li>
              <li>
                <span>
                  Name it <b>Sayso</b>, set authentication to <b>No authentication</b>, and paste this as the MCP server URL:
                </span>
              </li>
            </ol>
            <CopyField value={links.shoppingMcp} />
            <ol className="steps" start={3} style={{ counterReset: 'step 2' }}>
              <li>
                <span>Tick the box that says you trust the connector, then press <b>Create</b>.</span>
              </li>
              <li>
                <span>
                  In a new chat, ask it to use Sayso: &ldquo;Use Sayso to find me a handmade mug under $40.&rdquo; It searches every shop, builds the cart
                  and shows it with a <b>Pay with PayPal</b> button.
                </span>
              </li>
            </ol>
            <p className="small soft">
              Shop owners connect their own agent the same way, with the personal MCP URL from <b>Agents</b> in their dashboard (the key is in the URL, so
              again no authentication). Rather not set anything up? <a href="/assistant">Shop on this site</a>, with a cart or Sayso&apos;s assistant.
            </p>
          </section>

          <section id="pay" className="doc-section">
            <h2>Pay without a link each time</h2>
            <p>
              Ask your assistant to set up PayPal (it calls <code>connect_paypal</code>). You get a Sayso page where you choose two limits, then approve
              once in PayPal.
            </p>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>Inside your limits</td>
                    <td>Your assistant pays on its own. The shop still checks stock before charging.</td>
                  </tr>
                  <tr>
                    <td>Over a limit</td>
                    <td>Nothing is charged. You get a normal PayPal link to approve that one order.</td>
                  </tr>
                  <tr>
                    <td>Changing limits</td>
                    <td>Only by disconnecting and approving again. Your assistant can&apos;t raise them.</td>
                  </tr>
                  <tr>
                    <td>Disconnecting</td>
                    <td>From the same page, at any time. PayPal forgets the saved account.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              After approving, you see a personal shopping URL once. Use it as your connector instead of the plain one and your assistant can pay inside
              your limits in any chat. Treat it like a password.
            </p>
          </section>

          <section id="run" className="doc-section">
            <h2>Run your shop with your agent</h2>
            <ol className="steps">
              <li>
                <span>
                  <a href="/start">Upload photos of your pieces</a>: Sayso drafts each listing and suggests a price from similar items. Check the draft on
                  the same page (names, prices, stock, shipping) and confirm every price,{' '}
                  {paypalLogin ? (
                    <>
                      then <b>Publish with PayPal</b>: signing in claims the shop and publishes it. Signing in with PayPal is the only thing that approves
                      money moves; no agent key can.
                    </>
                  ) : (
                    <>then publish. You get an owner secret: it signs you in and is the only thing that approves money moves.</>
                  )}
                </span>
              </li>
              <li>
                <span>
                  In your dashboard, open <b>Agents</b> and press <b>Connect an agent</b>. For ChatGPT or Claude, add the address below as a custom
                  connector: the app sends you to Sayso to allow it and gets a key of its own (OAuth), so there is nothing secret to copy. Any other MCP
                  app, a script or the terminal gets a key you copy once.
                </span>
              </li>
            </ol>
            <div className="copy-field" aria-label="Address for ChatGPT, Claude or any MCP app that signs in with OAuth">
              <code>{links.sellerMcp}</code>
            </div>
            <p>
              Your agent can now check orders, refund, add tracking, invoice custom orders, change prices and stock, plan made-to-order work, and propose
              rules. Anything over your limits waits for you on your phone, and the agent is told so. Revoke its key in Agents and it stops working at
              once.
            </p>
            <p>
              Your dashboard&apos;s <b>Overview</b> shows the week against the one before (revenue, orders, average order, refund rate), what your agents
              did with your money, the latest orders and where they came from, and an in-depth report of every request, sale and money move, each
              checked against PayPal. <b>Assistant</b> answers questions about your own shop (sales, refunds and net for any period, a month-end
              estimate, what waits for you) and only reads. <b>Orders</b>, <b>Catalog</b>, <b>Making</b> and <b>Activity</b> hold the rest.
            </p>
          </section>

          <section id="paid" className="doc-section">
            <h2>Get paid into your PayPal</h2>
            <p>
              Signing in with PayPal only tells Sayso who you are. To have sales paid into your account, press <b>Set up payments</b> in your dashboard
              and allow Sayso two things in PayPal: to take payments for you, and to refund them. From then on every sale lands in your account
              directly; Sayso never holds your money.
            </p>
            <p>
              Refunds of those sales come out of your account, still only inside your rules or with your OK. Sayso checks with PayPal which account you
              connected and what you allowed before it relies on either. Each order shows which account it was paid into.
            </p>
          </section>

          <section id="cli" className="doc-section">
            <h2>The sayso CLI</h2>
            <p>
              The same tools from a terminal, for you or for a coding agent. Node.js 22.18 or later, no install: run it from the{' '}
              <a href={ABOUT.repository}>repository</a>.
            </p>
            <CopyField value={links.cliLogin('sk_agent_...')} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {CLI.map(([cmd, what]) => (
                    <tr key={cmd}>
                      <td className="mono">{cmd}</td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Add <code>--json</code> to any command for machine-readable output. Exit codes: <b>0</b> done, <b>3</b> waiting for the owner, <b>4</b>{' '}
              refused, <b>1</b> error, <b>2</b> usage. The repository also ships an agent skill (<code>skills/sayso/SKILL.md</code>) that teaches an agent
              to drive the CLI.
            </p>
          </section>

          <section id="guard" className="doc-section">
            <h2>How your money is protected</h2>
            <p>
              Every refund, charge and rule change goes through the same steps: simulated against the live PayPal payment, checked against your rules,
              sent once, read back from PayPal, and written to a log that shows any later edit.
            </p>
            <div className="panel">
            <ul className="rules">
              <li>
                <span className="rule-kind ok-text">Alone</span>
                <span>Refunds and charges inside your rules, tracking, prices and stock.</span>
              </li>
              <li>
                <span className="rule-kind rule-ask">Asks you</span>
                <span>Anything over your limits, the first invoice to someone who has never paid you, every refund a buyer asks for, and every change to your rules.</span>
              </li>
              <li>
                <span className="rule-kind rule-block">Never</span>
                <span>An agent approving its own request, raising its own limits, or seeing your PayPal credentials.</span>
              </li>
            </ul>
            </div>
            <p>
              Write your rules in plain words, for example &ldquo;refunds over $30 need my OK; invoices to new clients always need my OK&rdquo;. They become
              exact rules you can read in <b>Rules</b>, and the rules decide, not the AI.
            </p>
            <p>
              When you keep approving the same kind of request, Sayso suggests letting your agent handle those alone, up to what you approved and
              never past anything you turned down. Your agent can ask for that rule too, but only you can say yes: agents earn autonomy, they never
              take it.
            </p>
          </section>

          <section id="paypal" className="doc-section">
            <h2>PayPal&apos;s commerce platform</h2>
            <p>
              Every shop also implements PayPal&apos;s Agentic Commerce merchant-cart API, so assistants on PayPal&apos;s platform can buy without any
              setup by the shopper:
            </p>
            <CopyField value={links.merchantCart('<shop>')} />
            <p className="small soft">
              <code>POST</code> creates a priced cart, <code>PUT /{'{id}'}</code> replaces it, <code>POST /{'{id}'}/checkout</code> completes it after the
              buyer approves. Problems come back as validation issues with resolution options an agent can apply.
            </p>
            <p>
              To find shops and products over plain HTTP, use <code>GET /api/shops</code> and <code>GET /api/shops/{'{shop}'}/products?query=</code>. The whole
              API is described in an <a href={links.openApi}>OpenAPI spec</a>. From it, APIMatic generates{' '}
              {portal ? (
                <>
                  the <a href={links.developers}>developer portal</a> (reference, try-it console and guides) and{' '}
                </>
              ) : null}
              typed SDKs for TypeScript and Python, in the repository&apos;s <code>sdk/</code> folder.
            </p>
          </section>

          <section id="reference" className="doc-section">
            <h2>Reference</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MCP endpoint</th>
                    <th>Who</th>
                    <th>Tools</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">/api/shopping/mcp</td>
                    <td>Shoppers, every shop</td>
                    <td className="small">list_shops, search_products, create_cart, update_cart, get_cart, request_refund, connect_paypal, wallet_status, pay_with_paypal</td>
                  </tr>
                  <tr>
                    <td className="mono">/api/shopping/mcp/&lt;wallet key&gt;</td>
                    <td>Shoppers with saved PayPal</td>
                    <td className="small">The same, paying inside their limits</td>
                  </tr>
                  <tr>
                    <td className="mono">/api/shops/&lt;shop&gt;/mcp</td>
                    <td>Shoppers, one shop</td>
                    <td className="small">The shopping tools for that shop only</td>
                  </tr>
                  <tr>
                    <td className="mono">/api/mcp/&lt;agent key&gt;</td>
                    <td>The owner&apos;s agent</td>
                    <td className="small">shop_overview, list_products, update_variant, price_check, production_board, plan_job, finish_job, list_orders, get_order, refund_order, add_tracking, send_invoice, list_invoices, list_approvals, get_say_so, get_policy, propose_policy, rule_suggestions, propose_rule_suggestion, audit_log</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small soft">
              MCP over Streamable HTTP, protocol {MCP_VERSIONS[0]} (also {MCP_VERSIONS.slice(1).join(' and ')}). Clients that send headers can use <code>/api/mcp</code> and{' '}
              <code>/api/shopping/mcp</code> with <code>Authorization: Bearer &lt;key&gt;</code>. Full details in the{' '}
              <a href={`${ABOUT.repository}#readme`}>README</a>.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
