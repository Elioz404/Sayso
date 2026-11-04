'use client';

// An Activity record opened in place, as its receipt. While it waits for the owner they can answer right
// here; the receipt and the list behind it then show the answer and what PayPal did.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordView } from '@/core/record-view.ts';
import { callApi } from './api.ts';
import { Decision } from './owner-actions.tsx';
import { RecordReceipt } from './record-receipt.tsx';

export function RecordModal({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
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
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    void load();
  }, [load]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label="Activity record"
      onClose={onClose}
      // A click on the dimmed backdrop (the dialog itself, outside its content) closes it.
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="modal-body">
        <button type="button" className="modal-close" aria-label="Close" onClick={() => dialog.current?.close()}>
          ×
        </button>
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
          <p className="error small">{error}</p>
        ) : (
          <div className="receipt-loading" aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </dialog>
  );
}
