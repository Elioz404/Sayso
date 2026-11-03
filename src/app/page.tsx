import { CopyField } from '@/app/_components/client-ui.tsx';
import { Icon, Who } from '@/app/_components/ui.tsx';
import { baseUrl } from '@/server/context.ts';

const FLOW = [
  { name: 'Propose', text: 'An agent asks to refund, charge or change a rule.' },
  { name: 'Simulate', text: 'Checked against the live PayPal payment first.' },
  { name: 'Rules', text: 'Your rules decide: go, ask you, or block.' },
  { name: 'Your OK', text: 'Big moves wait for you, on your phone.', owner: true },
  { name: 'Execute', text: 'Sent to PayPal once, with an idempotency key.' },
  { name: 'Verify', text: 'Read back from PayPal before it counts.' },
  { name: 'Record', text: 'Written to a log that shows any tampering.' },
];

export default function Home() {
  const url = baseUrl();
  return (
    <main className="wrap stack-lg" style={{ gap: 72 }}>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">For one-person shops</span>
          <h1>
            AI shoppers buy from you. Your own agent runs the shop. <em>You keep the say-so.</em>
          </h1>
          <p className="lede">
            Sayso turns a few photos and a price list into a shop that AI assistants can buy from with PayPal. Your agent handles
            orders, refunds and tracking from a terminal or any MCP client, and anything big waits for your OK.
          </p>
          <div className="row">
            <a className="btn btn-primary" href="/start">
              Open your shop <Icon name="arrow" size={17} />
            </a>
            <a className="btn" href="/shop/maya-ceramics">
              See the demo shop
            </a>
          </div>
        </div>

        <div className="hero-card">
          <div className="sayso-card" aria-label="Example: a refund waiting for the owner's say-so">
            <div className="spread">
              <Who actor={{ type: 'agent', id: 'agent:laptop agent' }} />
              <span className="eyebrow">Example</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="soft">Refund to the buyer of order SAY-MW0AN1IA</span>
              <span className="amount">$20.00</span>
            </div>
            <p className="quote">&ldquo;Handle cracked in transit.&rdquo;</p>
            <ul className="facts">
              <li>
                <span>Would do</span>
                <span>Refund $20.00. $19.99 of $44.99 stays charged.</span>
              </li>
              <li>
                <span>Needs you</span>
                <span>$20.00 is over your $10.00 limit for refunds.</span>
              </li>
            </ul>
            <div className="decide" aria-hidden="true">
              <span className="btn btn-primary">
                <Icon name="check" size={17} /> Say OK
              </span>
              <span className="btn btn-danger">Reject</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stack-lg">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">One shop, three ways in</span>
          <h2>Buyers&apos; agents shop. Your agent works. You decide.</h2>
        </div>
        <div className="doors">
          <div className="door door-buyer">
            <span className="door-icon"><Icon name="bag" size={20} /></span>
            <h3>Shoppers&apos; AI assistants</h3>
            <p className="soft small">
              Your catalog speaks PayPal&apos;s merchant-cart API and MCP. Assistants get exact prices, shipping and tax, fix stock
              problems on their own, and the buyer pays in PayPal.
            </p>
          </div>
          <div className="door door-agent">
            <span className="door-icon"><Icon name="terminal" size={20} /></span>
            <h3>Your own agent</h3>
            <p className="soft small">
              <code>sayso status</code>, <code>sayso refund</code>, <code>sayso track</code> from a terminal, any MCP client or an agent
              skill. It holds a limited key, never your PayPal login.
            </p>
          </div>
          <div className="door door-owner">
            <span className="door-icon"><Icon name="shield" size={20} /></span>
            <h3>You</h3>
            <p className="soft small">
              Write rules in plain English. Refunds, charges and rule changes that cross them wait for your OK, and only you can give it.
            </p>
          </div>
        </div>
      </section>

      <section className="stack-lg">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">What happens to every money move</span>
          <h2>Checked before, verified after, recorded always</h2>
        </div>
        <ol className="flow">
          {FLOW.map((s) => (
            <li key={s.name} className={s.owner ? 'flow-owner' : undefined}>
              <b>{s.name}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="split">
        <div className="stack" style={{ gap: 16 }}>
          <span className="eyebrow">For your agent</span>
          <h2>Built for agents to drive</h2>
          <p className="soft">
            Every command has <code>--json</code> output, and the exit code says what happened: <b>3</b> means it is waiting for you,
            <b> 4</b> means a rule or PayPal stopped it. An agent can branch on that without guessing.
          </p>
          <p className="soft">
            This is a real run against the PayPal sandbox: a small refund goes through, a bigger one waits, and one that would overpay
            is stopped before PayPal is called.
          </p>
        </div>
        <pre className="term">
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 5.00 --reason &quot;Glaze drip&quot;{'\n'}
          <span className="c">done</span>: refund.create $5.00{'\n'}
          <span className="d">  $39.99 of $44.99 stays captured.</span>{'\n\n'}
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 20.00 --reason &quot;Cracked handle&quot;{'\n'}
          <span className="w">waiting for the owner</span>: refund.create $20.00{'\n'}
          <span className="d">  why: $20.00 is over the $10.00 limit for refunds.</span>{'\n'}
          <span className="d">  exit 3</span>{'\n\n'}
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 30.00 --reason &quot;The rest&quot;{'\n'}
          <span className="x">refused</span>: refund.create $30.00{'\n'}
          <span className="d">  why: exceeds the $19.99 still refundable.</span>{'\n'}
          <span className="d">  exit 4</span>
        </pre>
      </section>

      <section className="panel stack" style={{ gap: 16 }}>
        <div className="spread">
          <div className="stack" style={{ gap: 6 }}>
            <h2>Shop the demo from your own assistant</h2>
            <p className="soft">Add this MCP server to any MCP client and ask it for a hand-thrown mug. No key needed.</p>
          </div>
          <a className="btn" href="/owner">
            Watch it as the owner <Icon name="arrow" size={17} />
          </a>
        </div>
        <CopyField value={`${url}/api/shops/maya-ceramics/mcp`} />
      </section>
    </main>
  );
}
