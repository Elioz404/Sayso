// Shown with a 404 when the order isn't one of this shop's.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack">
      <h1>Order not found</h1>
      <Link href="/owner/orders">Back to orders</Link>
    </div>
  );
}
