import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { Icon, Who } from '@/app/_components/ui.tsx';
import { ABOUT } from '@/core/about.ts';
import { siteLinks } from '@/server/context.ts';

const FLOW = [
  { name: 'Propose', text: 'An agent asks to refund, charge or change a rule.' },
  { name: 'Simulate', text: 'Checked against the live PayPal payment first.' },
  { name: 'Rules', text: 'Your rules decide: go ahead, ask you, or block.' },
  { name: 'Your OK', text: 'Anything over your limits waits for you.', owner: true },
  { name: 'Execute', text: 'Sent to PayPal once, never twice.' },
  { name: 'Verify', text: 'Read back from PayPal before it counts.' },
  { name: 'Record', text: 'Logged so any later edit shows.' },
];

export default async function Home() {
  await connection(); // URLs come from PUBLIC_BASE_URL at request time, not at build time
  const links = siteLinks();
  return (
    <main className="wrap landing" style={{ paddingBottom: 'var(--s8)' }}>
      <section className="hero">
        <div className="hero-copy">
          <h1>Let AI shoppers buy from your shop, and let your own agent run it.</h1>
          <p className="lede">
            Sayso turns a few photos and a price list into a shop that AI assistants can buy from with PayPal. Your agent handles orders,
            refunds and tracking. Anything that moves real money past your limits waits for your OK on your phone.
          </p>
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <a className="btn btn-primary" href="/start">
              Open your shop <Icon name="arrow" size={17} />
            </a>
            <a className="btn" href={`/shop/${ABOUT.demoShop}`}>
              See the demo shop
            </a>
          </div>
        </div>

        <figure className="sayso-card" style={{ margin: 0 }} aria-label="Example: a refund waiting for the owner">
          <div className="spread">
            <Who actor={{ type: 'agent', id: 'agent:laptop agent' }} />
            <span className="small muted">asks for your OK</span>
          </div>
          <div className="stack" style={{ gap: 'var(--s2)' }}>
            <span className="soft small">Refund for order SAY-MW0AN1IA</span>
            <span className="amount">$20.00</span>
          </div>
          <p className="reason">&ldquo;Handle cracked in transit.&rdquo;</p>
          <ul className="facts">
            <li>
              <span>Would do</span>
              <span>Refund $20.00. $19.99 of $44.99 stays charged.</span>
            </li>
            <li>
              <span>Needs you</span>
              <span className="needs">$20.00 is over your $10.00 refund limit.</span>
            </li>
          </ul>
          <div className="decide" aria-hidden="true">
            <span className="btn btn-primary">
              <Icon name="check" size={17} /> Say OK
            </span>
            <span className="btn btn-danger">Reject</span>
          </div>
          <figcaption className="small muted">From a real run on the PayPal sandbox.</figcaption>
        </figure>
      </section>

      <section className="stack" style={{ gap: 'var(--s5)' }}>
        <h2>One shop, three ways in</h2>
        <div className="ways">
          <div>
            <h3>
              <Icon name="bag" size={20} /> Shoppers&apos; assistants
            </h3>
            <p className="soft">They get exact prices, shipping and tax, fix stock problems on their own, and the buyer pays in PayPal.</p>
            <span className="via">PayPal merchant-cart API · MCP</span>
          </div>
          <div>
            <h3>
              <Icon name="terminal" size={20} /> Your own agent
            </h3>
            <p className="soft">Checks orders, refunds, adds tracking and restocks. It holds a limited key, never your PayPal login.</p>
            <span className="via">sayso CLI · MCP · agent skill</span>
          </div>
          <div>
            <h3>
              <Icon name="shield" size={20} /> You
            </h3>
            <p className="soft">Write your limits in plain words. Refunds, charges and rule changes that cross them wait for you, and only you.</p>
            <span className="via">Phone approvals · dashboard</span>
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 'var(--s5)' }}>
        <h2>What happens to every money move</h2>
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
        <div className="stack" style={{ gap: 'var(--s4)' }}>
          <h2>Built for agents to drive</h2>
          <p className="soft">
            Every command has <code>--json</code> output, and the exit code says what happened: <b>3</b> means it is waiting for you,{' '}
            <b>4</b> means a rule or PayPal stopped it. An agent can act on that without guessing.
          </p>
          <p className="soft">
            On the right, a real run against the PayPal sandbox: a small refund goes through, a bigger one waits for the owner, and one
            that would overpay is stopped before PayPal is called.
          </p>
        </div>
        <pre className="term">
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 5.00 --reason &quot;Glaze drip&quot;{'\n'}
          <span className="c">done</span>: refund $5.00{'\n'}
          <span className="d">  $39.99 of $44.99 stays captured.</span>
          {'\n\n'}
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 20.00 --reason &quot;Cracked handle&quot;{'\n'}
          <span className="w">waiting for the owner</span>: refund $20.00{'\n'}
          <span className="d">  why: $20.00 is over the $10.00 limit for refunds. (exit 3)</span>
          {'\n\n'}
          <span className="p">$ </span>sayso refund SAY-MW0AN1IA 30.00 --reason &quot;The rest&quot;{'\n'}
          <span className="x">refused</span>: refund $30.00{'\n'}
          <span className="d">  why: exceeds the $19.99 still refundable. (exit 4)</span>
        </pre>
      </section>

      <section className="panel stack" style={{ gap: 'var(--s4)' }}>
        <div className="spread">
          <div className="stack" style={{ gap: 'var(--s1)' }}>
            <h2 style={{ fontSize: 'var(--t-xl)' }}>Shop from your own assistant</h2>
            <p className="soft">Add this one MCP server to any MCP client and ask for a hand-thrown mug. It searches every shop on Sayso. No key needed.</p>
          </div>
          <a className="btn" href="/owner">
            Watch it as the owner <Icon name="arrow" size={17} />
          </a>
        </div>
        <CopyField value={links.shoppingMcp} />
      </section>
    </main>
  );
}
