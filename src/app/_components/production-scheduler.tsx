'use client';

// Bryntum Scheduler for the made-to-order board: one row per job, a payment bar that PayPal decides and
// a making bar the owner can drag or stretch. The payment bar leads into the making bar, so an unpaid
// commission visibly holds its work back. Loaded only in the browser (see production-board.tsx).

import { BryntumScheduler } from '@bryntum/scheduler-react';
import type { EventModel } from '@bryntum/scheduler';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ProductionJob } from '@/core/production.ts';
import { callApi } from './api.ts';
import './production.css';

const DAY_MS = 86_400_000;
const ROW_HEIGHT = 56;

/** "2026-11-12" as a local calendar date, the way the scheduler draws days. */
function localDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A payment bar can be one day wide, so it carries an icon; the whole story is in the tooltip. */
const PAYMENT = {
  waiting: { color: 'orange', icon: 'fa fa-hourglass-half', title: 'Unpaid', detail: (j: ProductionJob) => `Waiting for ${j.payment.amount} in PayPal since ${j.payment.since}` },
  deposit: { color: 'teal', icon: 'fa fa-coins', title: 'Deposit paid', detail: (j: ProductionJob) => `Deposit paid in PayPal on ${j.payment.paidOn} (total ${j.payment.amount})` },
  paid: { color: 'green', icon: 'fa fa-check', title: 'Paid', detail: (j: ProductionJob) => `${j.payment.amount} paid in PayPal on ${j.payment.paidOn}` },
} as const;

export default function ProductionScheduler({ jobs, today }: { jobs: ProductionJob[]; today: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();

  const data = useMemo(() => {
    const resources = jobs.map((j) => ({ id: j.id, name: j.title, reference: j.reference, customer: j.customer ?? '' }));
    const events = jobs.flatMap((j) => {
      const paidOn = j.payment.paidOn ?? today;
      const payment = {
        id: `${j.id}#pay`,
        resourceId: j.id,
        name: '',
        iconCls: PAYMENT[j.payment.state].icon,
        title: PAYMENT[j.payment.state].title,
        detail: PAYMENT[j.payment.state].detail(j),
        startDate: localDay(j.payment.since),
        endDate: new Date(Math.max(localDay(paidOn).getTime(), localDay(j.payment.since).getTime()) + DAY_MS),
        eventColor: PAYMENT[j.payment.state].color,
        draggable: false,
        resizable: false,
        cls: 'board-payment',
      };
      if (!j.making) return [payment];
      const making = {
        id: `${j.id}#make`,
        resourceId: j.id,
        name: j.blocked ? 'Making, once paid' : 'Making',
        title: j.blocked ? 'Blocked until the buyer pays' : 'Making',
        detail: `${j.making.start} to ${j.making.end}${j.blocked ? ': starts when the buyer pays' : j.making.by === 'owner' ? ', as you planned it' : `, ${j.makeDays} days from payment`}`,
        startDate: localDay(j.making.start),
        endDate: new Date(localDay(j.making.end).getTime() + DAY_MS), // the scheduler's end is exclusive
        eventColor: j.blocked ? 'gray' : 'blue',
        cls: j.blocked ? 'board-blocked' : 'board-making',
      };
      return [payment, making];
    });
    const dependencies = jobs.filter((j) => j.making).map((j) => ({ id: `${j.id}#dep`, from: `${j.id}#pay`, to: `${j.id}#make` }));
    const days = events.flatMap((e) => [e.startDate.getTime(), e.endDate.getTime()]);
    const now = localDay(today).getTime();
    return {
      resources,
      events,
      dependencies,
      startDate: new Date(Math.min(now, ...days) - DAY_MS),
      endDate: new Date(Math.max(now + 21 * DAY_MS, ...days) + 3 * DAY_MS),
    };
  }, [jobs, today]);

  async function savePlan(event: EventModel) {
    const jobId = String(event.resourceId);
    const start = dayOf(event.startDate as Date);
    const end = dayOf(new Date((event.endDate as Date).getTime() - DAY_MS));
    try {
      await callApi(`/api/owner/production/${encodeURIComponent(jobId)}`, 'PATCH', { start, end });
      setMessage({ tone: 'ok', text: `Planned ${event.resource?.getData('name') ?? 'the job'}: ${start} to ${end}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: `Not saved: ${(err as Error).message}` });
    }
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <p className={`small ${message?.tone === 'error' ? 'error' : 'soft'}`} role="status" aria-live="polite">
        {message?.text ?? 'Drag or stretch a Making bar to plan it. Payment bars come from PayPal and can’t be moved.'}
      </p>
      <div className="production-board" style={{ height: Math.min(640, 64 + Math.max(jobs.length, 3) * ROW_HEIGHT) }}>
        <BryntumScheduler
          resources={data.resources}
          events={data.events}
          dependencies={data.dependencies}
          startDate={data.startDate}
          endDate={data.endDate}
          viewPreset="weekAndDayLetter"
          tickSize={44}
          rowHeight={ROW_HEIGHT}
          barMargin={10}
          columns={[
            {
              text: 'Job',
              field: 'name',
              width: 240,
              htmlEncode: false,
              renderer: ({ record }: { record: { getData: (f: string) => string } }) =>
                `<div class="board-job"><b>${escapeHtml(record.getData('name'))}</b><small>${escapeHtml(record.getData('reference'))}${record.getData('customer') ? ` · ${escapeHtml(record.getData('customer'))}` : ''}</small></div>`,
            },
          ]}
          timeRangesFeature={{ showCurrentTimeLine: true }}
          eventTooltipFeature={{
            template: ({ eventRecord }: { eventRecord: EventModel }) =>
              `<b>${escapeHtml(String(eventRecord.getData('title') ?? ''))}</b><br>${escapeHtml(String(eventRecord.getData('detail') ?? ''))}`,
          }}
          dependenciesFeature={{ allowCreate: false }}
          eventDragFeature={{ constrainDragToResource: true }}
          eventDragCreateFeature={false}
          eventEditFeature={false}
          eventMenuFeature={false}
          scheduleMenuFeature={false}
          cellEditFeature={false}
          onEventDrop={({ eventRecords }) => void savePlan(eventRecords[0])}
          onEventResizeEnd={({ eventRecord, changed }) => {
            if (changed) void savePlan(eventRecord);
          }}
        />
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
