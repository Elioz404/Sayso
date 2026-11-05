// Shown with a 404 when the request isn't one of this shop's.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Request not found</h1>
      <p className="soft">It doesn&apos;t belong to the shop you&apos;re signed in to.</p>
      <Link href="/owner">Back to your shop</Link>
    </main>
  );
}
