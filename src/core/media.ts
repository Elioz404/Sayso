// Photos sellers upload (opening a shop, adding a product, reading a label), kept so each product
// shows the picture it came from. They arrive as data URLs downscaled in the browser (about 1600 px,
// JPEG), are checked here once for every route, and are served back at /media/<id>.

import { randomBytes } from 'node:crypto';
import { HttpError } from './errors.ts';
import { MAX_PHOTO_CHARS } from './photo-limits.ts';

export { MAX_DRAFT_PHOTOS, MAX_ONBOARDING_PHOTOS } from './photo-limits.ts';

export interface StoredPhoto {
  id: string;
  /** The shop it belongs to, so it goes when the shop or the draft does. */
  shopId?: string;
  /** image/jpeg, image/png, image/webp or image/gif */
  type: string;
  /** The image bytes, base64. */
  data: string;
  createdAt: string;
}

export interface MediaStore {
  put(photo: StoredPhoto): Promise<void>;
  get(id: string): Promise<StoredPhoto | undefined>;
  /** Delete photos by id, only those of `shopId`. */
  remove(shopId: string, ids: string[]): Promise<void>;
  /** Delete every photo of a shop (when the shop goes). */
  removeShop(shopId: string): Promise<void>;
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/** The photos in a request body, or a 400 saying what is wrong. The one check every photo route uses. */
export function checkPhotos(value: unknown, max: number): string[] {
  const photos = Array.isArray(value) ? value : [];
  if (!photos.length) throw new HttpError(400, 'Add a photo');
  if (photos.length > max) throw new HttpError(400, `Up to ${max} photos`);
  if (photos.some((p) => typeof p !== 'string' || p.length > MAX_PHOTO_CHARS || !DATA_URL.test(p))) {
    throw new HttpError(400, 'Photos must be PNG, JPEG, WebP or GIF, under 2 MB each');
  }
  return photos as string[];
}

/** A stored photo for a data URL that passed checkPhotos; undefined if it isn't one. */
export function photoFromDataUrl(dataUrl: string, shopId?: string, now = new Date()): StoredPhoto | undefined {
  const m = DATA_URL.exec(dataUrl);
  return m ? { id: `med_${randomBytes(9).toString('hex')}`, shopId, type: m[1], data: m[2], createdAt: now.toISOString() } : undefined;
}

/** The media id inside a /media/<id> path, if it is one. */
export function mediaIdOf(url: string | undefined): string | undefined {
  return /^\/media\/(med_[a-f0-9]{18})$/.exec(url ?? '')?.[1];
}

export class MemoryMediaStore implements MediaStore {
  private readonly photos = new Map<string, StoredPhoto>();
  async put(photo: StoredPhoto) {
    this.photos.set(photo.id, photo);
  }
  async get(id: string) {
    return this.photos.get(id);
  }
  async remove(shopId: string, ids: string[]) {
    for (const id of ids) if (this.photos.get(id)?.shopId === shopId) this.photos.delete(id);
  }
  async removeShop(shopId: string) {
    for (const [id, photo] of this.photos) if (photo.shopId === shopId) this.photos.delete(id);
  }
}
