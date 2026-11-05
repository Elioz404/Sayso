// Shown with a 404 when the shop has no such product.
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Product not found</h1>
      <p className="soft">
        It may have been removed. <Link href="/shops">See the shops</Link>
      </p>
    </main>
  );
}
