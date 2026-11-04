'use client';

// On the PayPal return page: tells the server this browser paid for the order, so it can ask for a
// refund on it later without signing in.

import { useEffect } from 'react';
import { callApi } from './api.ts';

export function PaidHere({ cart, token }: { cart: string; token: string }) {
  useEffect(() => {
    callApi('/api/orders/claim', 'POST', { cart, token }).catch(() => undefined);
  }, [cart, token]);
  return null;
}
