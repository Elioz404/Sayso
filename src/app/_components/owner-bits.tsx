// Small pieces the owner's pages share: where an order came from, and its product photo.

import { channelName } from '@/core/trust-report.ts';

const KIND: Record<string, 'ai' | 'site' | 'cart' | 'owner' | 'api'> = {
  'AI assistants over MCP': 'ai',
  'Shop with AI on Sayso': 'site',
  'Cart on Sayso': 'cart',
  'Your agent': 'owner',
  'PayPal merchant-cart API': 'api',
  'Judges tour': 'site',
};
const SHORT: Record<string, string> = {
  'AI assistants over MCP': 'AI assistant · MCP',
  'Shop with AI on Sayso': 'Shop with AI',
  'Cart on Sayso': 'Cart',
  'Your agent': 'Your agent',
  'PayPal merchant-cart API': 'Merchant-cart API',
  'Judges tour': 'Judges tour',
  Unknown: 'Unknown',
};

/** Where an order came from, as a small badge: an assistant over MCP, Shop with AI, the cart, the owner's agent. */
export function ChannelBadge({ channel }: { channel?: string }) {
  const name = channelName(channel);
  return (
    <span className={`channel channel-${KIND[name] ?? 'api'}`} title={name}>
      {SHORT[name] ?? name}
    </span>
  );
}

/** A product photo at thumbnail size, or a quiet placeholder. */
export function Thumb({ src, size = 40 }: { src?: string; size?: number }) {
  return (
    <span className="thumb" style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" loading="lazy" />}
    </span>
  );
}
