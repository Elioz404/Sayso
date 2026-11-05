// Every error the app shows, announced to screen readers as it appears (role="alert"). Nothing when there
// is no error. `id`: so the field it belongs to can point at it (aria-describedby).
import type { ReactNode } from 'react';

export function ErrorText({ children, id, inline = false, small = true }: { children?: ReactNode; id?: string; inline?: boolean; small?: boolean }) {
  if (!children) return null;
  const className = small ? 'error small' : 'error';
  return inline ? (
    <span id={id} className={className} role="alert">
      {children}
    </span>
  ) : (
    <p id={id} className={className} role="alert">
      {children}
    </p>
  );
}
