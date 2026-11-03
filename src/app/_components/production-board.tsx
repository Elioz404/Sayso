'use client';

// The made-to-order board, rendered only in the browser: Bryntum measures the page and touches the DOM
// directly. A skeleton holds its place while it loads.

import dynamic from 'next/dynamic';
import type { ProductionJob } from '@/core/production.ts';

const ProductionScheduler = dynamic(() => import('./production-scheduler.tsx'), {
  ssr: false,
  loading: () => <div className="grid-skeleton" style={{ height: 280 }} aria-hidden="true" />,
});

export function ProductionBoard({ jobs, today }: { jobs: ProductionJob[]; today: string }) {
  return <ProductionScheduler jobs={jobs} today={today} />;
}
