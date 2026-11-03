// GET /api/shops/{slug}/products?query=green+mug&max_price=40&in_stock_only=true
// What one shop sells, for agent platforms that call REST instead of MCP. Same view as search_products.
import { productQuery } from '@/core/search.ts';
import { shopOffer } from '@/core/tools/views.ts';
import { flag, handle, liveCatalog } from '@/server/http.ts';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const catalog = await liveCatalog((await params).slug);
    const search = new URL(request.url).searchParams;
    const query = productQuery(catalog, {
      query: search.get('query') ?? undefined,
      max_price: search.get('max_price') ?? undefined,
      in_stock_only: flag(search, 'in_stock_only'),
    });
    return Response.json(shopOffer(catalog, query));
  });
}
