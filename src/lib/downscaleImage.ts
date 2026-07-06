// Shrink an image in the browser before uploading. Phone/camera photos are
// often 5–12MB at 4000px+, which makes uploads crawl and the server work hard.
// A featured image renders at most ~1600px wide, so 2400px is plenty of source
// for crisp display + crops, at a fraction of the bytes.
export async function downscaleImage(file: File, maxDim = 2400, quality = 0.85): Promise<File> {
  // Leave non-raster and animated formats alone (can't safely re-encode).
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    // Already small enough — don't bother re-encoding.
    if (scale >= 1 && file.size < 1_500_000) { bitmap.close?.(); return file; }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), "image/jpeg", quality));
    if (!blob) return file;
    // If somehow larger than the original, keep the original.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // any failure: fall back to uploading the original
  }
}
