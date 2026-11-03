// Task-first docs for people on the site: shop from an assistant, let it pay, run a shop with an agent.
// Every URL is built from this server's public address, so the deployed page shows the real ones.
import { connection } from 'next/server';
import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { ABOUT } from '@/core/about.ts';
import { MCP_VERSIONS } from '@/core/mcp.ts';
import { developerPortalBuilt, siteLinks } from '@/server/context.ts';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Connect Sayso to ChatGPT or any MCP client, let your assistant pay inside your limits, and run a shop with your own agent.',
};

const SECTIONS = [
  { id: 'shop', title: 'Shop from your assistant' },
  { id: 'pay', title: 'Pay without a link each time' },
  { id: 'run', title: 'Run your shop with your agent' },
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
  ['sayso audit', 'Every money move with its hash-chain check'],
  ['sayso mcp', 'Serve the tools to a local MCP client over stdio'],
];

export default async function Docs() {
  await connection(); // URLs come from PUBLIC_BASE_URL at request time, not at build time
  const links = siteLinks();
  const portal = developerPortalBuilt();
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
              Sayso connects small shops to AI assistants through PayPal. Shoppers&apos; assistants buy, the shop owner&apos;s own agent runs the shop, and
              money only moves inside the rules each person set.
            </p>
            <p className="small muted">This demo runs on the PayPal sandbox. No real money moves.</p>
          </header>

          <section id="shop" className="doc-section">
            <h2>Shop from your assistant</h2>
            <p>One MCP server covers every shop on Sayso. No account or key needed.</p>
            <CopyField value={links.shoppingMcp} />
            <ol className="steps">
              <li>
                <span>
                  Add it as a connector in your assistant: in ChatGPT, a custom connector or app with developer mode on; in any other MCP client, a
                  remote server with this URL.
                </span>
              </li>
              <li>
                <span>Ask for what you want, for example &ldquo;a green hand-thrown mug, shipped to Austin&rdquo;.</span>
              </li>
              <li>
                <span>Your assistant builds the cart with the shop&apos;s real prices, shipping and tax, and gives you a PayPal link. You approve there.</span>
              </li>
              <li>
                <span>
                  Later, ask &ldquo;where is my order?&rdquo; or &ldquo;it arrived broken, ask for a refund&rdquo;. Refund requests go to the shop owner,
                  who decides.
                </span>
              </li>
            </ol>
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
                  <a href="/start">Draft your shop</a> from photos and a price list, check it, and publish. You get an owner secret: it signs you in and is the
                  only thing that approves money moves.
                </span>
              </li>
              <li>
                <span>
                  In your dashboard, open <b>Agents</b> and press <b>Connect an agent</b>. You get a personal URL like the one below. Paste it as a
                  connector in ChatGPT or any MCP client.
                </span>
              </li>
            </ol>
            <div className="copy-field" aria-label="Example personal URL">
              <code>{links.sellerMcpFor('sk_agent_...')}</code>
            </div>
            <p>
              Your agent can now check orders, refund, add tracking, invoice custom orders, change prices and stock, and propose rules. Anything over your limits waits for you on
              your phone, and the agent is told so. Revoke the key in Agents and the URL stops working at once.
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
                    <td className="small">shop_overview, list_products, update_variant, list_orders, get_order, refund_order, add_tracking, send_invoice, list_invoices, list_approvals, get_say_so, get_policy, propose_policy, rule_suggestions, propose_rule_suggestion, audit_log</td>
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
