// Shop and product photos. Pictures from hosts the image optimizer knows (next.config.ts) are resized
// and cached by this site; anything else is shown as is. Credits for openly licensed photos are listed
// with PhotoCredits wherever the photos appear.
import Image from 'next/image';
import type { PhotoCredit } from '@/core/catalog.ts';

const OPTIMIZED = new Set(['upload.wikimedia.org']);

export function ShopPhoto({ url, alt, sizes, priority = false }: { url: string; alt: string; sizes: string; priority?: boolean }) {
  const optimized = OPTIMIZED.has(new URL(url).hostname);
  return <Image src={url} alt={alt} fill sizes={sizes} priority={priority} unoptimized={!optimized} className="photo-img" />;
}

/** "Photos: <author> (licence), ..." with each linking to the photo's page. */
export function PhotoCredits({ credits }: { credits: { what: string; credit: PhotoCredit }[] }) {
  if (!credits.length) return null;
  return (
    <p className="photo-credits small muted">
      Photos via Wikimedia Commons:{' '}
      {credits.map(({ what, credit }, i) => (
        <span key={credit.source}>
          {i > 0 && ' · '}
          {what} by <a href={credit.source}>{credit.author}</a> ({credit.license})
        </span>
      ))}
    </p>
  );
}
