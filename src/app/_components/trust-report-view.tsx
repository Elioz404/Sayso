'use client';

// AG Studio draws in the browser only; this loads it there and shows a quiet placeholder meanwhile.
import dynamic from 'next/dynamic';
import type { TrustReport } from '@/core/trust-report.ts';

const TrustStudio = dynamic(() => import('./trust-studio.tsx'), {
  ssr: false,
  loading: () => <div className="trust-loading small muted">Loading the report…</div>,
});

export function TrustReportView({ data, licenseKey }: { data: TrustReport; licenseKey?: string }) {
  return <TrustStudio data={data} licenseKey={licenseKey} />;
}
