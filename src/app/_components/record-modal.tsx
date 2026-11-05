'use client';

// An Activity record opened in place, as its receipt. While it waits for the owner they can answer right
// here; the receipt and the list behind it then show the answer and what PayPal did.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { RecordView } from '@/core/record-view.ts';
import { callApi } from './api.ts';
import { Modal } from './modal.tsx';
import { Decision } from './owner-actions.tsx';
import { RecordReceipt } from './record-receipt.tsx';

export function RecordModal({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ record: RecordView; passkey: boolean }>();
  const [error, setError] = useState<string>();

  const load = useCallback(
    () =>
      callApi<{ record: RecordView; passkey: boolean }>(`/api/owner/activity/${id}`, 'GET').then(
        (d) => (setData(d), setError(undefined)),
        (err: Error) => setError(err.message),
      ),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal onClose={onClose} label="Activity record">
      {data ? (
        <RecordReceipt record={data.record}>
          {data.record.status === 'pending_approval' && (
            <Decision
              id={data.record.id}
              big
              passkey={data.passkey}
              onDone={() => {
                void load();
                router.refresh();
              }}
            />
          )}
        </RecordReceipt>
      ) : error ? (
        <p className="error small" role="alert">
          {error}
        </p>
      ) : (
        <div className="receipt-loading" aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </Modal>
  );
}
