// Where Android's share sheet sends photos to the installed app. The service worker normally catches
// this request and hands the photos to /owner/catalog/new itself; this is the fallback when it hasn't
// started yet: open the page so the owner picks the photos there.
import { siteLinks } from '@/server/context.ts';

const toPage = () => Response.redirect(`${siteLinks().base}/owner/catalog/new`, 303);

export const POST = toPage;
export const GET = toPage;
