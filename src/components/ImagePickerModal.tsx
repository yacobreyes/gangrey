"use client";

import { useState, useEffect } from "react";
import { uploadImage, updateMediaAsset } from "@/app/admin/actions";
import { straightenQuotes } from "@/lib/straighten";
import { downscaleImage } from "@/lib/downscaleImage";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%",
  boxSizing: "border-box", color: TEXT_DARK, outline: "none", background: "white",
};
const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.75rem", fontWeight: 700,
  color: TEXT_MUTED, letterSpacing: "0.08em", textTransform: "uppercase",
  display: "block", marginBottom: "0.3rem",
};

// Labeled field with an optional required marker and live character count,
// mirroring Axios's image metadata form.
function Field({ label, required, count, max, children }: { label: string; required?: boolean; count?: number; max?: number; children: React.ReactNode }) {
  const over = max != null && (count ?? 0) > max;
  return (
    <div>
      <label style={{ ...LABEL, display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
        <span>{label}{required && <span style={{ color: CRIMSON }}> *</span>}</span>
        {max != null && <span style={{ fontWeight: 400, color: over ? CRIMSON : TEXT_MUTED, textTransform: "none", letterSpacing: 0 }}>{count}/{max}</span>}
      </label>
      {children}
    </div>
  );
}

const ALT_HELP = "Describe the image for readers who can't see it — screen readers read this aloud, and it helps search ranking.";

export type PickedImage = { assetId: string; url: string; caption: string; alt: string; isNew?: boolean };
type MediaAsset = { _id: string; url: string; originalFilename?: string; description?: string; altText?: string };

// Request a downsized derivative for grid/preview thumbnails so the library
// doesn't pull full-resolution photos (megabytes each) to show at ~130px.
// Local media (/media/...) supports a ?w= width param; leave other URLs alone.
function thumb(url: string, w: number) {
  return url.startsWith("/media/") ? `${url}${url.includes("?") ? "&" : "?"}w=${w}` : url;
}

export default function ImagePickerModal({
  isMobile = false,
  onClose,
  onSelect,
}: {
  isMobile?: boolean;
  onClose: () => void;
  onSelect: (img: PickedImage) => void;
}) {
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [caption, setCaption] = useState("");
  const [alt, setAlt] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/media").then(r => r.json()).then(d => { if (Array.isArray(d)) setAssets(d); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function acceptFile(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { alert("Please choose an image file (JPEG, PNG, GIF, or WEBP)."); return; }
    setUploadFile(f);
    setUploadPreviewUrl(URL.createObjectURL(f));
  }

  async function handleUse() {
    if (tab === "library" && selected) {
      // Library images are already in the story-ready library — reuse as-is,
      // no forced re-crop (isNew: false).
      onSelect({ assetId: selected._id, url: selected.url, caption, alt, isNew: false });
      onClose();
    } else if (tab === "upload" && uploadFile) {
      if (!alt.trim()) { alert("Please add alt text before using this image."); return; }
      if (!caption.trim()) { alert("Please add a caption & credit before using this image."); return; }
      setUploading(true);
      try {
        const fd = new FormData(); fd.set("file", await downscaleImage(uploadFile));
        const { assetId, url } = await uploadImage(fd);
        await updateMediaAsset(assetId, { description: caption, ...(alt ? { altText: alt } : {}) });
        onSelect({ assetId, url, caption, alt, isNew: true });
        onClose();
      } catch (err) {
        alert(
          (err instanceof Error ? err.message : "Upload failed.") +
          "\n\nIf this is a large photo, try an image under 12MB."
        );
      }
      finally { setUploading(false); }
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: isMobile ? 0 : 10, width: isMobile ? "100vw" : "min(880px, 95vw)", height: isMobile ? "100dvh" : "min(600px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "1rem 1.5rem", borderBottom: `1px solid ${BORDER}` }}>
          <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", margin: "0 0 0.75rem", color: TEXT_DARK }}>Add featured image</p>
          <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${BORDER}`, marginBottom: -1 }}>
            {(["library", "upload"] as const).map(t => (
              <button key={t} type="button" onClick={() => {
                  // Switching tabs starts fresh — otherwise a library image's alt
                  // and caption bleed into the Upload tab (and vice versa).
                  setTab(t);
                  setSelected(null); setCaption(""); setAlt("");
                  setUploadFile(null); setUploadPreviewUrl("");
                }}
                style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? CRIMSON : "transparent"}`, marginBottom: -2, padding: "0.4rem 1rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: tab === t ? CRIMSON : TEXT_MUTED, cursor: "pointer" }}>
                {t === "library" ? "Library" : "Upload new"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
          {tab === "library" && (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
                {loading ? (
                  <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
                ) : assets.length === 0 ? (
                  <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>No images in library yet.</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                    {assets.map(a => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={a._id} src={thumb(a.url, 260)} alt={a.originalFilename} loading="lazy"
                        onClick={() => { setSelected(a); setCaption(a.description ?? ""); setAlt(a.altText ?? ""); }}
                        style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 4, cursor: "pointer", border: `2px solid ${selected?._id === a._id ? CRIMSON : "transparent"}`, boxSizing: "border-box" }} />
                    ))}
                  </div>
                )}
              </div>
              {selected && (
                <div style={{ width: isMobile ? "auto" : 280, maxHeight: isMobile ? "46dvh" : undefined, flexShrink: 0, borderLeft: isMobile ? "none" : `1px solid ${BORDER}`, borderTop: isMobile ? `1px solid ${BORDER}` : "none", padding: isMobile ? "1rem" : "1.25rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb(selected.url, 560)} alt="" style={{ width: "100%", height: isMobile ? 110 : 160, objectFit: "cover", borderRadius: 6 }} />
                  <Field label="Alt text" count={alt.length} max={300}>
                    <input style={INPUT} value={alt} onChange={e => setAlt(straightenQuotes(e.target.value))} placeholder="Describe this image…" />
                    <p style={{ fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, margin: "0.35rem 0 0", lineHeight: 1.4 }}>{ALT_HELP}</p>
                  </Field>
                  <Field label="Caption & credit"><input style={INPUT} value={caption} onChange={e => setCaption(straightenQuotes(e.target.value))} placeholder="e.g. Photo: Jane Doe via Unsplash" /></Field>
                </div>
              )}
            </>
          )}

          {tab === "upload" && (
            <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? "1.1rem" : "1.5rem", padding: isMobile ? "1rem" : "1.5rem", overflowY: "auto" }}>
              <div style={{ flex: 1 }}>
                {!uploadPreviewUrl ? (
                  <label
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
                    onDrop={e => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `2px dashed ${dragOver ? CRIMSON : BORDER}`, background: dragOver ? "rgba(139,0,0,0.04)" : "transparent", borderRadius: 8, padding: "2.5rem 1rem", cursor: "pointer", textAlign: "center", transition: "border-color 0.15s, background 0.15s" }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={dragOver ? CRIMSON : TEXT_MUTED} strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: "0.75rem" }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <p style={{ fontFamily: FONT, fontSize: "0.9rem", color: TEXT_DARK, margin: "0 0 0.25rem", fontWeight: 600 }}>Drag image here or <span style={{ color: CRIMSON }}>click to upload</span></p>
                    <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: 0 }}>JPEG, PNG, GIF, or WEBP</p>
                    <input type="file" accept="image/*" onChange={e => acceptFile(e.target.files?.[0])} style={{ display: "none" }} />
                  </label>
                ) : (
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadPreviewUrl} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6, marginBottom: "0.5rem" }} />
                    <button type="button" onClick={() => { setUploadFile(null); setUploadPreviewUrl(""); }} style={{ background: "none", border: "none", fontFamily: FONT, fontSize: "0.8rem", color: TEXT_MUTED, cursor: "pointer", padding: 0 }}>Remove</button>
                  </div>
                )}
              </div>
              <div style={{ width: isMobile ? "auto" : 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <Field label="Alt text" required count={alt.length} max={300}>
                  <input style={INPUT} value={alt} onChange={e => setAlt(straightenQuotes(e.target.value))} placeholder="Describe this image…" />
                  <p style={{ fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, margin: "0.35rem 0 0", lineHeight: 1.4 }}>{ALT_HELP}</p>
                </Field>
                <Field label="Caption & credit" required>
                  <input style={INPUT} value={caption} onChange={e => setCaption(straightenQuotes(e.target.value))} placeholder="e.g. Photo: Jane Doe via Unsplash" />
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", padding: "0.85rem 1.5rem", borderTop: `1px solid ${BORDER}`, background: "#ffffff" }}>
          <button type="button" onClick={onClose} style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.4rem 1.1rem", fontFamily: FONT, fontSize: "0.88rem", cursor: "pointer", color: TEXT_DARK }}>Cancel</button>
          <button type="button" onClick={handleUse} disabled={uploading || (tab === "library" && !selected) || (tab === "upload" && (!uploadFile || !caption.trim() || !alt.trim()))}
            style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.4rem 1.1rem", fontFamily: FONT, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", opacity: (tab === "library" && !selected) || (tab === "upload" && (!uploadFile || !caption.trim() || !alt.trim())) ? 0.5 : 1 }}>
            {uploading ? "Uploading…" : "Use this image"}
          </button>
        </div>
      </div>
    </div>
  );
}
