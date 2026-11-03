// Render health check: the app is up and its stores (Postgres on Render) answer.
import { demoCatalog } from '@/core/demo-shop.ts';
import { ready } from '@/server/context.ts';

export async function GET() {
  try {
    const { catalogs, model } = await ready();
    const demo = await catalogs.byShopId(demoCatalog.shop.id);
    return Response.json({ ok: Boolean(demo), storage: process.env.DATABASE_URL ? 'postgres' : 'memory', ai: model?.name ?? 'not configured' });
  } catch (err) {
    console.error('[health]', err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
