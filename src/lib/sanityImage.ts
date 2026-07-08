// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SanityImageSource = any;

// Sanity was fully removed — images are local /media/... files served by the
// /media route. urlFor survives only so legacy imports compile; nothing should
// reach it anymore.
export function urlFor(_source: SanityImageSource): never {
  throw new Error("Sanity image builder was removed — post images are local /media URLs (use postImageUrl).");
}

// A manual crop rectangle, stored as fractions (0..1) of the source image.
export type CropRect = { x: number; y: number; w: number; h: number };
export type ImageCrops = Record<string, CropRect>;

// The aspect ratios that render at distinct sizes and can be cropped manually.
// 16:9 covers the hero, story lead, and social share; 1.35:1 covers card
// thumbnails and list rows. (The mobile square hero reuses the 16:9 crop.)
export const CROP_RATIOS: { key: string; label: string; ratio: number }[] = [
  { key: "16:9", label: "Wide — hero, story & social", ratio: 16 / 9 },
  { key: "1.35:1", label: "Thumbnail — cards & list rows", ratio: 1.35 },
];

// Pick which stored crop applies to a requested render size, by nearest ratio.
export function ratioKey(width?: number, height?: number): string {
  if (!width || !height) return "16:9";
  const r = width / height;
  return CROP_RATIOS.reduce((best, o) => (Math.abs(o.ratio - r) < Math.abs(best.ratio - r) ? o : best)).key;
}

// Post image URL: posts carry a plain `url` (/media/... on local disk, resized
// + cropped by the /media route). Components use this instead of reading
// `image.url` directly so resize/crop params stay in one place.
export function postImageUrl(
  image: { asset?: SanityImageSource; url?: string; crops?: ImageCrops } | undefined | null,
  width?: number,
  height?: number,
): string | null {
  if (!image) return null;
  // Legacy Sanity-era shape: some stored docs carry {asset: {_ref}} where the
  // ref, on this backend, is the /media/... path itself. Fold it into `url`.
  const assetRef = (image.asset as { _ref?: string } | undefined)?._ref;
  if (!image.url && typeof assetRef === "string" && assetRef.startsWith("/")) {
    image = { ...image, url: assetRef };
  }
  if (!image.url) return null;
  // Local image: hand the /media route a resize (and manual crop, if set for
  // this ratio) so it serves a right-sized, correctly-framed derivative.
  const params = new URLSearchParams();
  if (width) params.set("w", String(width));
  if (height) params.set("h", String(height));
  const crop = image.crops?.[ratioKey(width, height)];
  if (crop) params.set("crop", `${crop.x.toFixed(4)},${crop.y.toFixed(4)},${crop.w.toFixed(4)},${crop.h.toFixed(4)}`);
  const qs = params.toString();
  return qs ? `${image.url}?${qs}` : image.url;
}
