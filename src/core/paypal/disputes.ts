// Disputes a buyer opens in PayPal about a payment. Sayso only reads them: the owner answers in PayPal's
// Resolution Center, where the evidence and the deadlines live.

import type { Money } from '../money.ts';
import type { PayPalClient } from './client.ts';

export interface Dispute {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_amount?: Money;
  disputed_transactions?: { seller_transaction_id?: string }[];
  create_time: string;
  update_time?: string;
  seller_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string };
}

export const getDispute = (client: PayPalClient, disputeId: string) => client.get<Dispute>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);

/** Where the owner answers disputes in PayPal (their Resolution Center lists each one). */
export function resolutionCenterUrl(webBase: string): string {
  return `${webBase}/resolutioncenter`;
}
