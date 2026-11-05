// Shown with a 404 for any address Sayso doesn't have.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Page not found</h1>
      <p className="soft">
        <Link href="/">Back to Sayso</Link>
      </p>
    </main>
  );
}
