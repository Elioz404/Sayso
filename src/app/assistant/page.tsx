// Shop with AI lives in the side panel. Old links to /assistant (docs, the tour, the README) land on the
// shops with the panel open, keeping a written request if there was one.
import { redirect } from 'next/navigation';

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const ask = (await searchParams).ask?.slice(0, 300);
  redirect(ask ? `/shops?ask=${encodeURIComponent(ask)}` : '/shops?assistant=1');
}
