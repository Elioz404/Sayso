import { baseUrl } from '@/server/context.ts';

export default function Home() {
  const url = baseUrl();
  return (
    <main>
      <section className="hero">
        <h1>Sell to AI shoppers. Run your shop with your own AI agent. Nothing moves without your say-so.</h1>
        <p>
          Sayso turns a few photos and a price list into a shop that AI shopping agents can buy from through PayPal, and gives your
          own agent a CLI and MCP tools to run it. Refunds, captures and rule changes follow your rules, and the big ones wait for
          your OK on your phone.
        </p>
        <div className="row">
          <a className="button primary" href="/start">Start selling</a>
          <a className="button" href="/shop/maya-ceramics">See the demo shop</a>
        </div>
      </section>

      <div className="grid" style={{ marginTop: 28 }}>
        <div className="card">
          <h3>Buyer agents check out</h3>
          <p className="small muted">
            Your catalog speaks PayPal&apos;s agentic-commerce merchant-cart API and MCP. Agents get exact prices, shipping and tax,
            fix stock problems with resolution options, and the buyer approves in PayPal.
          </p>
        </div>
        <div className="card">
          <h3>Your agent runs the shop</h3>
          <p className="small muted">
            <code>sayso status</code>, <code>sayso refund</code>, <code>sayso track</code>: from the terminal, any MCP client or an agent
            skill. It holds a scoped key, never your PayPal credentials.
          </p>
        </div>
        <div className="card">
          <h3>You keep the say-so</h3>
          <p className="small muted">
            Every money move is simulated against live PayPal state, checked against your rules, verified after it runs and written to
            a tamper-evident log. Agents can ask; only you approve.
          </p>
        </div>
      </div>

      <h2>Try it from your own agent</h2>
      <pre>{`# any MCP client, buyer side (no key needed)
${url}/api/shops/maya-ceramics/mcp

# the shop owner's side, from a terminal
node cli/sayso.ts login --url ${url} --key sk_agent_...
node cli/sayso.ts status`}</pre>
    </main>
  );
}
