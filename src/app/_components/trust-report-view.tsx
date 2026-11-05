'use client';

// The Overview's "In depth" report. AG Studio and the 90 days of data behind it are fetched only once the
// section comes into view, so opening the Overview costs neither; a quiet placeholder shows meanwhile.
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { TrustReport } from '@/core/trust-report.ts';
import { callApi } from './api.ts';
import { ErrorText } from './error-text.tsx';

const TrustStudio = dynamic(() => import('./trust-studio.tsx'), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder() {
  return <div className="trust-loading small muted">Loading the report…</div>;
}

export function TrustReportView({ licenseKey }: { licenseKey?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [wanted, setWanted] = useState(false);
  const [data, setData] = useState<TrustReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setWanted(true);
        seen.disconnect();
      }
    }, { rootMargin: '400px 0px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let gone = false;
    callApi<TrustReport>('/api/owner/report', 'GET').then(
      (report) => !gone && setData(report),
      (err: Error) => !gone && setError(err.message),
    );
    return () => {
      gone = true;
    };
  }, [wanted]);

  return (
    <div ref={box}>
      {data ? (
        <TrustStudio data={data} licenseKey={licenseKey} />
      ) : error ? (
        <ErrorText>The report could not load: {error}</ErrorText>
      ) : (
        <Placeholder />
      )}
    </div>
  );
}
