// Shop and product photos. Pictures in public/photos are resized by the image optimizer; sellers'
// uploads (/media, already downscaled in their browser) and anything else are shown as they are.
import Image from 'next/image';

export function ShopPhoto({ url, alt, sizes, priority = false }: { url: string; alt: string; sizes: string; priority?: boolean }) {
  return <Image src={url} alt={alt} fill sizes={sizes} priority={priority} unoptimized={!url.startsWith('/photos/')} className="photo-img" />;
}
