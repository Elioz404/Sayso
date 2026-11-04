// GET: every published shop. POST (onboarding): { text?, images?: data URLs, shop_name?, currency?,
// country? } -> a draft shop and a first agent key, returned exactly once. Where owners sign in with
// PayPal, this browser may then claim the shop (claim_url); otherwise the owner secret comes back, once.
import { HttpError } from '@/core/errors.ts';
import { checkPhotos } from '@/core/media.ts';
import { formatMoney } from '@/core/money.ts';
import { MAX_ONBOARDING_PHOTOS } from '@/core/photo-limits.ts';
import { shopSummary } from '@/core/search.ts';
import { ready } from '@/server/context.ts';
import { handle, PHOTO_BODY_LIMIT, readBody } from '@/server/http.ts';
import { clientAddress, onboarding } from '@/server/rate-limit.ts';
import { rememberClaim } from '@/server/seller-session.ts';

const ONBOARDING = {
  type: 'object',
  properties: {
    text: { type: 'string', maxLength: 8_000 },
    images: { type: 'array', maxItems: MAX_ONBOARDING_PHOTOS, items: { type: 'string' } },
    shop_name: { type: 'string', maxLength: 80 },
    currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    country: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    agent_label: { type: 'string', maxLength: 60 },
  },
} as const;

export async function GET() {
  return handle(async () => Response.json((await (await ready()).catalogs.listLive()).map(shopSummary)));
}

export async function POST(request: Request) {
  return handle(async () => {
    if (!onboarding.allow(clientAddress(request))) {
      throw new HttpError(429, 'Too many new shops from here; try again later');
    }
    const body = await readBody(request, ONBOARDING, PHOTO_BODY_LIMIT);
    const images = body.images?.length ? checkPhotos(body.images, MAX_ONBOARDING_PHOTOS) : [];

    const { shops, links, paypalLogin } = await ready();
    const result = await shops.onboard(
      { text: body.text, images, shopName: body.shop_name, currency: body.currency, country: body.country },
      body.agent_label || 'my agent',
      { ownerSecret: !paypalLogin },
    );
    const { shop } = result.catalog;
    if (paypalLogin) await rememberClaim(shop.id);
    return Response.json(
      {
        shop: { id: shop.id, slug: shop.slug, name: shop.name, status: shop.status },
        products: result.catalog.products.length,
        // What Sayso understood, for the owner to check before publishing.
        preview: result.catalog.products.map((p) => ({
          name: p.name,
          description: p.description,
          image: p.imageUrl,
          variants: p.variants.map((v) => ({
            title: v.title,
            price: v.price ? formatMoney(v.price, shop.currency) : 'No price yet',
            /** A price Sayso suggested (or none at all): the owner confirms it before publishing. */
            to_confirm: Boolean(v.priceToConfirm),
            stock: v.madeToOrderDays !== undefined ? `Made to order, ${v.madeToOrderDays} days` : `${v.inventory} in stock`,
          })),
        })),
        questions: result.questions,
        owner_secret: result.ownerSecret,
        claim_url: paypalLogin ? links.paypalSignIn : undefined,
        agent_key: result.agentKey,
        review_url: `${links.base}/owner`,
        mcp: { seller: links.sellerMcpFor(result.agentKey), buyer: links.shoppingMcp, this_shop: links.shopMcp(shop.slug) },
        cli_login: links.cliLogin(result.agentKey),
      },
      { status: 201 },
    );
  });
}
