'use client';

// On the PayPal return page, when that visit took the payment: tells the server this browser paid for the
// order, so it can ask for a refund on it later without signing in. `claim` is signed by the server.

import { useEffect } from 'react';
import { callApi } from './api.ts';

export function PaidHere({ claim }: { claim: string }) {
  useEffect(() => {
    callApi('/api/orders/claim', 'POST', { claim }).catch(() => undefined);
  }, [claim]);
  return null;
}
