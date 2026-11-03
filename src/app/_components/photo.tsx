// Shop and product photos. Pictures kept on this site (public/photos) are resized by the image
// optimizer; pictures elsewhere are shown as they are.
import Image from 'next/image';

export function ShopPhoto({ url, alt, sizes, priority = false }: { url: string; alt: string; sizes: string; priority?: boolean }) {
  return <Image src={url} alt={alt} fill sizes={sizes} priority={priority} unoptimized={!url.startsWith('/')} className="photo-img" />;
}
