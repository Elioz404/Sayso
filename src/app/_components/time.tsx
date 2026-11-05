'use client';

// Times are shown in the viewer's own time zone (in English, like the rest of the app), so they are
// formatted in the browser. The server renders the ISO date in a <time> element and the browser fills
// in the rest after hydration.

import { useEffect, useState } from 'react';

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : formatDay(iso);
}

function useFormatted(iso: string, format: (iso: string) => string): string | undefined {
  const [text, setText] = useState<string>();
  useEffect(() => setText(format(iso)), [iso, format]);
  return text;
}

/** "Nov 3, 4:05 PM" in the viewer's time zone. */
export function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{useFormatted(iso, formatWhen) ?? iso.slice(0, 10)}</time>;
}

/** "12 min ago", or a date once it is older than a day. */
export function Ago({ iso }: { iso: string }) {
  return <time dateTime={iso}>{useFormatted(iso, formatAgo) ?? iso.slice(0, 10)}</time>;
}

/** "Nov 3" in the viewer's time zone. */
export function Day({ iso }: { iso: string }) {
  return <time dateTime={iso}>{useFormatted(iso, formatDay) ?? iso.slice(0, 10)}</time>;
}
