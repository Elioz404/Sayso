'use client';

// One modal for the whole app, on the browser's own <dialog>: focus stays inside, the page behind is
// inert, and Escape, the backdrop and the close button all ask to close through `onClose`.
//
// `dismissible={false}` while closing by accident would lose something (unsaved edits, a key shown only
// once): Escape and the backdrop then do nothing, and only the close button or the content closes it. The
// backdrop counts only when the press started on it too, so a text selection dragged out of a field
// never closes it.

import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  open = true,
  onClose,
  dismissible = true,
  label,
  labelledBy,
  wide = false,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  dismissible?: boolean;
  label?: string;
  labelledBy?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        // Escape: closing is the parent's call, so the dialog never closes on its own.
        e.preventDefault();
        if (dismissible) onClose();
      }}
      // The browser may still close it (a second Escape, say): keep the parent in step.
      onClose={() => {
        if (open) onClose();
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === dialog.current;
      }}
      onClick={(e) => {
        if (e.target === dialog.current && pressedOnBackdrop.current && dismissible) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      {open && (
        <div className="modal-body">
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}
