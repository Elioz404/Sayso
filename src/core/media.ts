// Photos sellers upload while opening a shop, kept so each product shows the picture it came from.
// They arrive as data URLs (downscaled in the browser) and are served back at /media/<id>.

import { randomBytes } from 'node:crypto';

export interface StoredPhoto {
  id: string;
  /** image/jpeg, image/png, image/webp or image/gif */
  type: string;
  /** The image bytes, base64. */
  data: string;
  createdAt: string;
}

export interface MediaStore {
  put(photo: StoredPhoto): Promise<void>;
  get(id: string): Promise<StoredPhoto | undefined>;
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/** A stored photo for a data URL the onboarding route already accepted; undefined if it isn't one. */
export function photoFromDataUrl(dataUrl: string, now = new Date()): StoredPhoto | undefined {
  const m = DATA_URL.exec(dataUrl);
  return m ? { id: `med_${randomBytes(9).toString('hex')}`, type: m[1], data: m[2], createdAt: now.toISOString() } : undefined;
}

export class MemoryMediaStore implements MediaStore {
  private readonly photos = new Map<string, StoredPhoto>();
  async put(photo: StoredPhoto) {
    this.photos.set(photo.id, photo);
  }
  async get(id: string) {
    return this.photos.get(id);
  }
}
