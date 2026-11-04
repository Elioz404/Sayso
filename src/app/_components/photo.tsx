// Shop and product photos. Everything served from this site (public/photos, sellers' uploads at /media)
// goes through the image optimizer, so a grid thumbnail isn't a full-size photo; other hosts' images
// are shown as they are.
import Image from 'next/image';

export function ShopPhoto({ url, alt, sizes, priority = false }: { url: string; alt: string; sizes: string; priority?: boolean }) {
  return <Image src={url} alt={alt} fill sizes={sizes} priority={priority} unoptimized={!url.startsWith('/')} className="photo-img" />;
}
