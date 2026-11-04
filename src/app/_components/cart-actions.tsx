'use client';

// "Add to cart" on a variant of a shop's piece: it goes into this browser's cart for that shop and the
// panel opens on the cart, so the shopper sees it land.

import { useState } from 'react';
import { cartStore, OPEN_CART_EVENT, type CartLine } from './cart-store.ts';

export function AddToCart({ shop, line }: { shop: { slug: string; name: string }; line: Omit<CartLine, 'qty'> }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small add-to-cart"
      aria-label={`Add ${line.name}${line.variant ? `, ${line.variant}` : ''} to your cart`}
      onClick={() => {
        cartStore.add(shop, line);
        window.dispatchEvent(new CustomEvent(OPEN_CART_EVENT));
        setAdded(true);
        setTimeout(() => setAdded(false), 1400);
      }}
    >
      {added ? '✓ Added' : '+ Add'}
    </button>
  );
}
