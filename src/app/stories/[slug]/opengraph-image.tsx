import { ImageResponse } from "next/og";
import { getPost } from "@/lib/sanity";
import { postImageUrl } from "@/lib/sanityImage";

// Branded share card for each story: the photo as a full-bleed background with
// a dark scrim, the wordmark, and the section/headline/byline — so shared links
// look designed rather than like a bare photo. Runs in Node because getPost
// reads better-sqlite3, and uses postImageUrl so it works on either backend.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Gangrey";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug).catch(() => null);

  const headline = post?.headline ?? "Gangrey";
  const section = post?.section || "";
  const byline = post?.byline ? `By ${post.byline}` : "";

  // Fetch the photo as a data URL so a failed request degrades to the solid
  // background instead of breaking the whole image.
  let bg: string | null = null;
  const path = post ? postImageUrl(post.image, 1200, 630) : null;
  if (path) {
    try {
      const url = path.startsWith("http") ? path : SITE + path;
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        bg = `data:${mime};base64,${buf.toString("base64")}`;
      }
    } catch {
      // fall through — no background image
    }
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "relative", background: "#0f0b08", fontFamily: "sans-serif" }}>
        {bg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bg} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(15,11,8,0.94) 0%, rgba(15,11,8,0.4) 55%, rgba(15,11,8,0.12) 100%)" }} />
        <div style={{ position: "absolute", top: 44, left: 56, display: "flex", fontSize: 36, fontWeight: 800, color: "#ffffff", letterSpacing: 2 }}>GANGREY</div>
        <div style={{ display: "flex", flexDirection: "column", padding: 56, position: "relative" }}>
          {section && (
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#f0c9c9", marginBottom: 18 }}>{section}</div>
          )}
          <div style={{ display: "flex", fontSize: 62, fontWeight: 800, color: "#ffffff", lineHeight: 1.05, maxWidth: 1040 }}>{headline}</div>
          {byline && <div style={{ display: "flex", fontSize: 26, color: "#e8ded9", marginTop: 22 }}>{byline}</div>}
        </div>
      </div>
    ),
    { ...size }
  );
}
