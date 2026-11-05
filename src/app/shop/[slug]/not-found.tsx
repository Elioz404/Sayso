// Shown with a 404 when no published shop has this address.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Shop not found</h1>
      <p className="soft">
        It may not be published yet. <Link href="/shops">See all shops</Link>
      </p>
    </main>
  );
}
