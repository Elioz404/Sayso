'use client';

// Phone photos are 3-12 MB; Sayso only needs enough to read them. Downscaled in the browser to a JPEG
// data URL before upload, so it uploads fast and stays far under the server's limit.
import { PHOTO_MAX_SIDE } from '@/core/limits.ts';

export async function shrink(file: Blob, max = PHOTO_MAX_SIDE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Several photos at once: the ones that could be read, and how many could not (one bad photo loses only itself). */
export async function readPhotos(files: readonly Blob[]): Promise<{ read: string[]; failed: number }> {
  const results = await Promise.allSettled(files.map((f) => shrink(f)));
  const read = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return { read, failed: results.length - read.length };
}

/** What to say about photos that could not be read, or nothing. */
export function unreadPhotos(failed: number): string | undefined {
  if (!failed) return undefined;
  return `${failed === 1 ? "One photo couldn't be read here" : `${failed} photos couldn't be read here`}; try a JPEG or PNG.`;
}
