'use client';

// Bryntum Scheduler for the made-to-order board: one row per job, a payment bar that PayPal decides and
// a making bar the owner can drag or stretch. The payment bar leads into the making bar, so unpaid work
// visibly holds back. "Made" takes a job off the board. Loaded only in the browser
// (see production-board.tsx).

import { BryntumScheduler } from '@bryntum/scheduler-react';
import type { EventModel, Model } from '@bryntum/scheduler';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { PaymentState, ProductionJob } from '@/core/production.ts';
import { callApi } from './api.ts';
import './production.css';

const ROW_HEIGHT = 56;

/** "2026-11-12" as a local calendar date, the way the scheduler draws days. */
function localDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar arithmetic (not 24-hour steps), so daylight-saving days can't shift a date. */
function plusDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A payment bar can be one day wide, so it carries an icon; the whole story is in the tooltip. */
const PAYMENT: Record<PaymentState, { color: string; icon: string; title: string; detail: (j: ProductionJob) => string }> = {
  waiting: { color: 'orange', icon: 'fa fa-hourglass-half', title: 'Unpaid', detail: (j) => `Waiting for ${j.payment.amount} in PayPal since ${j.payment.since}` },
  held: { color: 'violet', icon: 'fa fa-hand', title: 'Waiting for your OK', detail: (j) => `The buyer approved ${j.payment.amount} in PayPal; it is charged when you accept the order` },
  deposit: { color: 'teal', icon: 'fa fa-coins', title: 'Deposit paid', detail: (j) => `Deposit paid in PayPal on ${j.payment.paidOn} (total ${j.payment.amount})` },
  paid: { color: 'green', icon: 'fa fa-check', title: 'Paid', detail: (j) => `${j.payment.amount} paid in PayPal on ${j.payment.paidOn}` },
  unknown: { color: 'gray', icon: 'fa fa-question', title: 'Payment unknown', detail: () => 'PayPal could not be read just now; refresh in a minute' },
};

const BLOCKED = { payment: 'starts when the buyer pays', owner: 'starts when you accept the order' } as const;

export default function ProductionScheduler({ jobs, today }: { jobs: ProductionJob[]; today: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();

  const data = useMemo(() => {
    const resources = jobs.map((j) => ({ id: j.id, name: j.title, reference: j.reference, customer: j.customer ?? '' }));
    const events = jobs.flatMap((j) => {
      const look = PAYMENT[j.payment.state];
      const since = localDay(j.payment.since);
      const until = localDay(j.payment.paidOn ?? today);
      const payment = {
        id: `${j.id}#pay`,
        resourceId: j.id,
        name: '',
        iconCls: look.icon,
        title: look.title,
        detail: look.detail(j),
        startDate: since,
        // Through the day it was paid, or through today while it hasn't been.
        endDate: plusDays(until < since ? since : until, 1),
        eventColor: look.color,
        draggable: false,
        resizable: false,
        cls: 'board-payment',
      };
      if (!j.making) return [payment];
      const making = {
        id: `${j.id}#make`,
        resourceId: j.id,
        name: j.blockedBy ? 'Making, once cleared' : 'Making',
        title: j.blockedBy ? 'Making is blocked' : 'Making',
        detail: `${j.making.start} to ${j.making.end}${j.blockedBy ? `: ${BLOCKED[j.blockedBy]}` : j.making.by === 'owner' ? ', as you planned it' : `, ${j.makeDays} days from payment`}`,
        startDate: localDay(j.making.start),
        endDate: plusDays(localDay(j.making.end), 1), // the scheduler's end is exclusive
        eventColor: j.blockedBy ? 'gray' : 'blue',
        cls: j.blockedBy ? 'board-blocked' : 'board-making',
      };
      return [payment, making];
    });
    const dependencies = jobs.filter((j) => j.making).map((j) => ({ id: `${j.id}#dep`, from: `${j.id}#pay`, to: `${j.id}#make` }));
    const times = events.flatMap((e) => [e.startDate.getTime(), e.endDate.getTime()]);
    const now = localDay(today);
    return {
      resources,
      events,
      dependencies,
      startDate: plusDays(new Date(Math.min(now.getTime(), ...times)), -1),
      endDate: plusDays(new Date(Math.max(plusDays(now, 21).getTime(), ...times)), 3),
    };
  }, [jobs, today]);

  async function act(text: string, request: Promise<unknown>) {
    try {
      await request;
      setMessage({ tone: 'ok', text });
    } catch (err) {
      setMessage({ tone: 'error', text: `Not saved: ${(err as Error).message}` });
    }
    router.refresh();
  }

  function savePlan(event: EventModel) {
    const jobId = String(event.resourceId);
    const start = dayOf(event.startDate as Date);
    const end = dayOf(plusDays(event.endDate as Date, -1));
    void act(`Planned ${event.resource?.getData('name') ?? 'the job'}: ${start} to ${end}.`, callApi(`/api/owner/production/${encodeURIComponent(jobId)}`, 'PATCH', { start, end }));
  }

  function markMade(record: Model) {
    void act(`${record.getData('name')} is made and off the board.`, callApi(`/api/owner/production/${encodeURIComponent(String(record.id))}`, 'POST'));
  }

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <p className={`small ${message?.tone === 'error' ? 'error' : 'soft'}`} role="status" aria-live="polite">
        {message?.text ?? 'Drag or stretch a Making bar to plan it, and press Made when a piece is done. Payment bars come from PayPal and can’t be moved.'}
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
              width: 270,
              htmlEncode: false,
              renderer: ({ record }: { record: Model }) =>
                `<div class="board-row"><div class="board-job"><b>${escapeHtml(String(record.getData('name')))}</b><small>${escapeHtml(String(record.getData('reference')))}${record.getData('customer') ? ` · ${escapeHtml(String(record.getData('customer')))}` : ''}</small></div><button type="button" class="board-made" data-action="made">Made</button></div>`,
            },
          ]}
          onCellClick={({ record, target }: { record: Model; target: HTMLElement }) => {
            if (target.closest('[data-action="made"]')) markMade(record);
          }}
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
          onEventDrop={({ eventRecords }) => savePlan(eventRecords[0])}
          onEventResizeEnd={({ eventRecord, changed }) => {
            if (changed) savePlan(eventRecord);
          }}
        />
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
