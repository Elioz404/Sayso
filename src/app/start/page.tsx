import type { Metadata } from 'next';
import { OnboardForm } from '@/app/_components/onboard-form.tsx';

export const metadata: Metadata = { title: 'Open your shop' };

export default function Start() {
  return (
    <main className="wrap page">
      <div className="split split-start">
        <div className="stack" style={{ gap: 'var(--s5)' }}>
          <div className="stack" style={{ gap: 'var(--s2)' }}>
            <h1>Open your shop to AI shoppers</h1>
            <p className="lede">Add a few photos and say what things cost. Sayso drafts the catalog for you to check.</p>
          </div>
          <OnboardForm />
        </div>

        <aside className="panel stack" style={{ alignSelf: 'start', gap: 'var(--s5)' }}>
          <h2>What happens next</h2>
          <ol className="steps">
            <li>
              <span className="stack" style={{ gap: 2 }}>
                <b>We draft your catalog</b>
                <span className="small soft">Products, variants, prices and stock. Anything unclear comes back as a question, never a guess.</span>
              </span>
            </li>
            <li>
              <span className="stack" style={{ gap: 2 }}>
                <b>You get two keys, once</b>
                <span className="small soft">An owner secret for you, and an agent key for the AI agent that will run the shop.</span>
              </span>
            </li>
            <li>
              <span className="stack" style={{ gap: 2 }}>
                <b>You check it and publish</b>
                <span className="small soft">Products are registered with PayPal and AI shoppers can buy.</span>
              </span>
            </li>
          </ol>
          <p className="small soft">Payments run on the PayPal sandbox in this demo. No real money moves.</p>
        </aside>
      </div>
    </main>
  );
}
