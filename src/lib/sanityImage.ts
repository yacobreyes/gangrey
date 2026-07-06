import imageUrlBuilder from "@sanity/image-url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SanityImageSource = any;

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";

// Image URL building only needs projectId/dataset, not a full Sanity client —
// importing from "@/lib/sanity" here would pull next-sanity's createClient
// into every client bundle that renders an image (i.e. the public homepage).
const builder = imageUrlBuilder({ projectId, dataset });

export function urlFor(source: SanityImageSource) {
  return builder.image(source);
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

// Backend-agnostic post image URL: self-hosted posts carry a plain `url`
// (/media/... on local disk, resized + cropped by the /media route), Sanity
// posts go through the CDN resizer. Components use this instead of guarding on
// `image.asset` directly.
export function postImageUrl(
  image: { asset?: SanityImageSource; url?: string; crops?: ImageCrops } | undefined | null,
  width?: number,
  height?: number,
): string | null {
  if (!image) return null;
  if (image.asset) {
    let b = builder.image(image.asset);
    if (width) b = b.width(width);
    if (height) b = b.height(height);
    return b.fit("crop").auto("format").url();
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
