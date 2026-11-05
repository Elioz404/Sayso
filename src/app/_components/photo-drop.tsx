'use client';

// Where photos go in: drop them or tap to choose (a phone offers its camera), shrunk in the browser so they
// upload fast, then shown as thumbnails with "Add more". Start selling and "Add from a photo" share it.

import { useState, type Dispatch, type SetStateAction } from 'react';
import { ErrorText } from './error-text.tsx';
import { readPhotos, unreadPhotos } from './images.ts';
import { Icon } from './ui.tsx';

/** Pictures of real-looking pieces, for trying the flow without photos of your own. */
const SAMPLES = ['/photos/mugs.webp', '/photos/bowl.webp', '/photos/vase.webp'];

export function PhotoDrop({ photos, setPhotos, max, samples = false, disabled = false }: { photos: string[]; setPhotos: Dispatch<SetStateAction<string[]>>; max: number; samples?: boolean; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const [unread, setUnread] = useState(0);
  const room = max - photos.length;

  async function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, room);
    const { read, failed } = await readPhotos(images);
    setUnread(failed);
    // Against the photos as they are when these are read, not as they were when picked.
    setPhotos((now) => [...now, ...read].slice(0, max));
  }
  const drag = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (!disabled) void add([...e.dataTransfer.files]);
    },
  };

  return (
    <div className="sell-photos">
      {photos.length === 0 ? (
        <label className={`sell-drop${over ? ' sell-drop-over' : ''}`} {...drag}>
          <span className="sell-drop-icon">
            <Icon name="camera" size={28} />
          </span>
          <b>Drop photos of your pieces</b>
          <span className="small soft">or tap to choose · up to {max} · JPEG, PNG, WebP or HEIC</span>
          <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" disabled={disabled} onChange={(e) => void add([...(e.target.files ?? [])])} />
        </label>
      ) : (
        <ul className={`sell-thumbs${over ? ' sell-drop-over' : ''}`} {...drag}>
          {photos.map((src, i) => (
            <li key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Photo ${i + 1}`} />
              <button type="button" className="sell-thumb-x" aria-label={`Remove photo ${i + 1}`} disabled={disabled} onClick={() => setPhotos((now) => now.filter((_, k) => k !== i))}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
          {room > 0 && !disabled && (
            <li>
              <label className="sell-add">
                <Icon name="plus" size={22} />
                <span className="small">Add more</span>
                <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => void add([...(e.target.files ?? [])])} />
              </label>
            </li>
          )}
        </ul>
      )}
      {samples && photos.length === 0 && (
        <button
          type="button"
          className="link-button small sell-samples"
          onClick={async () => {
            const files = await Promise.all(SAMPLES.map(async (src) => new File([await (await fetch(src)).blob()], src.split('/').pop()!, { type: 'image/webp' })));
            await add(files);
          }}
        >
          No photos at hand? Use sample photos
        </button>
      )}
      <ErrorText>{unreadPhotos(unread)}</ErrorText>
    </div>
  );
}
