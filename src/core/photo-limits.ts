// How many photos and how big, in one place for the server checks (src/core/media.ts) and the browser
// screens that pick and downscale them. Plain constants, safe to import anywhere.

/** Photos per request: a new shop can bring a few more than a batch of new products. */
export const MAX_ONBOARDING_PHOTOS = 8;
export const MAX_DRAFT_PHOTOS = 6;
/** A photo downscaled in the browser (about 1600 px JPEG) is a few hundred KB; this leaves room, no more. */
export const MAX_PHOTO_CHARS = 2_800_000; // ~2 MB once base64-encoded
/** Where the browser downscales photos to before upload (longest side, px). */
export const PHOTO_MAX_SIDE = 1600;
