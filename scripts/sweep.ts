// Run by the scheduled job (Render Cron): asks the app to clean up expired judges' tour copies.
// SAYSO_APP_URL is where the app answers (Render's private network address in the Blueprint);
// SAYSO_CRON_SECRET is the secret the app expects.
//
//   node scripts/sweep.ts

export {}; // a module, so top-level await type-checks

const app = process.env.SAYSO_APP_URL;
const secret = process.env.SAYSO_CRON_SECRET;
if (!app || !secret) {
  console.error('Set SAYSO_APP_URL and SAYSO_CRON_SECRET');
  process.exit(2);
}

const url = `${/^https?:\/\//.test(app) ? app : `http://${app}`}/api/internal/sweep`;
const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) });
const body = await res.text();
console.log(`${res.status} ${body}`);
if (!res.ok) process.exit(1);
