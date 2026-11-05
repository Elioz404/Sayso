// Shown with a 404 when the PayPal setup link is unknown.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Link not found</h1>
      <p className="soft">Ask your assistant to set up PayPal again.</p>
      <Link href="/">Back to Sayso</Link>
    </main>
  );
}
