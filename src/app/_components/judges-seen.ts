// What a judge has opened from For Judges (their order page, the shop's dashboard), kept in a plain cookie
// so the page can tick those steps off. Shared by the page (server) and its buttons (browser).

export const SEEN_COOKIE = 'sayso_judge_seen';

/** Notes in this browser that the judge opened `what` ("order", "shop"). */
export function markSeen(what: string): void {
  const now = (document.cookie.match(new RegExp(`(?:^|; )${SEEN_COOKIE}=([^;]*)`))?.[1] ?? '').split('.').filter(Boolean);
  if (now.includes(what)) return;
  document.cookie = `${SEEN_COOKIE}=${[...now, what].join('.')}; path=/; max-age=${30 * 86_400}; samesite=lax`;
}
