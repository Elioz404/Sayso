// A public shop by its slug, read once per request even when the page and its metadata both need it.
import 'server-only';
import { cache } from 'react';
import { ready } from './context.ts';

export const shopBySlug = cache(async (slug: string) => (await ready()).catalogs.bySlug(slug).catch(() => undefined));
