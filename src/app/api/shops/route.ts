// GET: every published shop. POST (onboarding): { text?, images?: data URLs, shop_name?, currency?,
// country? } -> a draft shop, with the owner secret and a first agent key returned exactly once.
import { HttpError } from '@/core/errors.ts';
import { shopSummary } from '@/core/search.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson } from '@/server/http.ts';
import { clientAddress, onboarding } from '@/server/rate-limit.ts';

const MAX_IMAGE_CHARS = 6_000_000; // ~4.5 MB per photo once base64-encoded

export async function GET() {
  return handle(async () => Response.json((await (await ready()).catalogs.listLive()).map(shopSummary)));
}

export async function POST(request: Request) {
  return handle(async () => {
    if (!onboarding.allow(clientAddress(request))) {
      throw new HttpError(429, 'Too many new shops from here; try again later');
    }
    const body = await readJson<{ text?: string; images?: string[]; shop_name?: string; currency?: string; country?: string; agent_label?: string }>(request);
    const images = (body.images ?? []).filter((i) => typeof i === 'string');
    if (images.length > 8) throw new HttpError(400, 'Up to 8 photos');
    if (images.some((i) => !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(i) || i.length > MAX_IMAGE_CHARS)) {
      throw new HttpError(400, 'Photos must be PNG, JPEG, WebP or GIF under ~4 MB');
    }

    const { shops, links } = await ready();
    const result = await shops.onboard(
      { text: body.text?.slice(0, 8_000), images, shopName: body.shop_name?.slice(0, 80), currency: body.currency, country: body.country },
      body.agent_label?.slice(0, 60) || 'my agent',
    );
    const { shop } = result.catalog;
    return Response.json(
      {
        shop: { id: shop.id, slug: shop.slug, name: shop.name, status: shop.status },
        products: result.catalog.products.length,
        questions: result.questions,
        owner_secret: result.ownerSecret,
        agent_key: result.agentKey,
        review_url: `${links.base}/owner`,
        mcp: { seller: links.sellerMcpFor(result.agentKey), buyer: links.shoppingMcp, this_shop: links.shopMcp(shop.slug) },
        cli_login: links.cliLogin(result.agentKey),
      },
      { status: 201 },
    );
  });
}
