// Photos owners send from their phone (drafting products, reading labels): data URLs the browser
// already downscaled. Checked here before anything reaches the AI.
import 'server-only';
import { HttpError } from '@/core/errors.ts';

const MAX_IMAGE_CHARS = 6_000_000; // ~4.5 MB per photo once base64-encoded

export function checkPhotos(value: unknown, max: number): string[] {
  const images = Array.isArray(value) ? value.filter((i): i is string => typeof i === 'string') : [];
  if (!images.length) throw new HttpError(400, 'Add a photo');
  if (images.length > max) throw new HttpError(400, `Up to ${max} photos`);
  if (images.some((i) => !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(i) || i.length > MAX_IMAGE_CHARS)) {
    throw new HttpError(400, 'Photos must be PNG, JPEG, WebP or GIF, under 4.5 MB each');
  }
  return images;
}
