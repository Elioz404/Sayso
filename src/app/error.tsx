'use client';

// Anything a page didn't expect lands here instead of a blank screen. The details stay in the server
// log; the person gets a way forward.

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>Something went wrong</h1>
      <p className="soft">This page could not load. Nothing was charged or changed by loading it.</p>
      <div className="row" style={{ gap: 'var(--s3)' }}>
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <a className="btn" href="/">
          Home
        </a>
      </div>
      {error.digest && <p className="small muted">Reference: <span className="mono">{error.digest}</span></p>}
    </main>
  );
}
