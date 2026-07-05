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

// Backend-agnostic post image URL: self-hosted posts carry a plain `url`
// (/media/... on local disk) with no Sanity asset, Sanity posts carry an asset
// ref that goes through the CDN resizer. Components use this instead of
// guarding on `image.asset` directly.
export function postImageUrl(
  image: { asset?: SanityImageSource; url?: string } | undefined | null,
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
  return image.url ?? null;
}
