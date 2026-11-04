'use client';

// "Shipped it?": snap the shipping label, Sayso reads the carrier and tracking number, the owner checks
// them and adds them to the PayPal order. The same carrier list and rules as everywhere (core/shipping).

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { CARRIERS } from '@/core/shipping.ts';
import { callApi } from './api.ts';
import { shrink } from './images.ts';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';

interface Reading {
  carrier: string | null;
  tracking_number: string | null;
  note: string | null;
}

export function LabelScanner({ orderId }: { orderId: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [carrier, setCarrier] = useState<string>('USPS');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const { busy, error, run } = useAction();

  const read = (picked: File) =>
    run(async () => {
      setNote(undefined);
      const image = await shrink(picked);
      setPreview(image);
      const r = await callApi<Reading>(`/api/owner/orders/${orderId}/label`, 'POST', { image });
      if (r.carrier) setCarrier(r.carrier);
      if (r.tracking_number) setNumber(r.tracking_number);
      setNote(r.note ?? (r.tracking_number ? 'Read from the label. Check it matches, then add it.' : undefined));
    }, 'read');

  const save = () =>
    run(async () => {
      await callApi(`/api/owner/orders/${orderId}/tracking`, 'POST', { carrier, tracking_number: number });
      router.refresh();
    }, 'save');

  return (
    <div className="scan">
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      <button type="button" className="btn scan-shoot" disabled={Boolean(busy)} onClick={() => file.current?.click()}>
        <Icon name="camera" size={18} /> {busy === 'read' ? 'Reading the label…' : 'Read it from a photo of the label'}
      </button>
      <div className="scan-row">
        {preview && <img src={preview} alt="The label you photographed" className="scan-preview" />}
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <div className="field">
            <label htmlFor={`carrier-${orderId}`}>Carrier</label>
            <select id={`carrier-${orderId}`} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`tracking-${orderId}`}>Tracking number</label>
            <input id={`tracking-${orderId}`} className="mono" autoCapitalize="characters" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="9400 1000 0000 0000 0000 00" />
          </div>
        </div>
      </div>
      {note && <p className="small soft">{note}</p>}
      <button type="button" className="btn btn-primary scan-save" disabled={Boolean(busy) || number.replace(/[\s-]/g, '').length < 8} onClick={() => void save()}>
        {busy === 'save' ? 'Adding to PayPal…' : 'Mark as shipped'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
