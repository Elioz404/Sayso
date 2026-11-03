import { OnboardForm } from '@/app/_components/onboard-form.tsx';
import { baseUrl } from '@/server/context.ts';

export default function Start() {
  return (
    <main className="narrow">
      <h1>Open your shop to AI shoppers</h1>
      <p className="muted">
        Snap your products and say what they cost. Sayso drafts the catalog; you check it and publish. Prices, stock and shipping are
        never guessed: anything unclear comes back as a question.
      </p>
      <OnboardForm origin={baseUrl()} />
    </main>
  );
}
