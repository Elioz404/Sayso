import type { Metadata } from 'next';
import { connection } from 'next/server';
import { OnboardFlow } from '@/app/_components/onboard-form.tsx';
import { paypalLoginEnabled } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Open your shop' };

export default async function Start() {
  await connection();
  return (
    <main className="wrap page">
      <OnboardFlow paypalLogin={paypalLoginEnabled()} />
    </main>
  );
}
