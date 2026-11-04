'use client';

// The busy / error / try-catch every button that calls the server needs, written once. `busy` names
// what is running (so a screen with several buttons can label the right one).

import { useCallback, useState } from 'react';

export function useAction() {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = useCallback(async <T,>(fn: () => Promise<T>, name = 'busy'): Promise<T | undefined> => {
    setBusy(name);
    setError(undefined);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }, []);
  return { busy, error, setError, run };
}
