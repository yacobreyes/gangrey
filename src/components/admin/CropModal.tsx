"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CROP_RATIOS, type CropRect, type ImageCrops } from "@/lib/sanityImage";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// A crop box in displayed pixels; its pixel aspect equals the target ratio.
type Box = { left: number; top: number; width: number; height: number };

// Largest centered box of `ratio` (w/h in pixels) that fits in dispW×dispH.
function defaultBox(dispW: number, dispH: number, ratio: number): Box {
  let width = dispW, height = width / ratio;
  if (height > dispH) { height = dispH; width = height * ratio; }
  return { left: (dispW - width) / 2, top: (dispH - height) / 2, width, height };
}

export default function CropModal({
  src, crops, isMobile = false, onSave, onClose,
}: {
  src: string;
  crops: ImageCrops;
  isMobile?: boolean;
  onSave: (crops: ImageCrops) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const ratio = CROP_RATIOS[step];
  const imgRef = useRef<HTMLImageElement>(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState<Box | null>(null);
  // Accumulated crop fractions across steps (seeded from any existing crops).
  const [result, setResult] = useState<ImageCrops>({ ...crops });
  const drag = useRef<null | { mode: "move" | "resize"; startX: number; startY: number; box: Box }>(null);

  const measure = useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDisp({ w: r.width, h: r.height });
  }, []);

  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure]);

  // (Re)seed the box whenever the step or the displayed size changes: load the
  // stored crop for this ratio if present, else a centered default.
  useEffect(() => {
    if (!disp.w || !disp.h) return;
    const stored = result[ratio.key];
    if (stored) {
      setBox({ left: stored.x * disp.w, top: stored.y * disp.h, width: stored.w * disp.w, height: stored.h * disp.h });
    } else {
      setBox(defaultBox(disp.w, disp.h, ratio.ratio));
    }
  }, [step, disp.w, disp.h]); // eslint-disable-line react-hooks/exhaustive-deps

  function clampBox(b: Box): Box {
    const width = Math.min(b.width, disp.w);
    const height = width / ratio.ratio;
    const left = Math.max(0, Math.min(b.left, disp.w - width));
    const top = Math.max(0, Math.min(b.top, disp.h - height));
    return { left, top, width, height };
  }

  function onPointerDown(e: React.PointerEvent, mode: "move" | "resize") {
    if (!box) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, box };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !box) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const b0 = drag.current.box;
    if (drag.current.mode === "move") {
      setBox(clampBox({ ...b0, left: b0.left + dx, top: b0.top + dy }));
    } else {
      // Resize from the bottom-right handle, anchored at top-left.
      const width = Math.max(40, b0.width + dx);
      setBox(clampBox({ left: b0.left, top: b0.top, width, height: width / ratio.ratio }));
    }
  }
  function onPointerUp() { drag.current = null; }

  function storeCurrent(): ImageCrops {
    if (!box || !disp.w || !disp.h) return result;
    const rect: CropRect = { x: box.left / disp.w, y: box.top / disp.h, w: box.width / disp.w, h: box.height / disp.h };
    return { ...result, [ratio.key]: rect };
  }

  function next() {
    const updated = storeCurrent();
    setResult(updated);
    if (step < CROP_RATIOS.length - 1) setStep(step + 1);
    else onSave(updated);
  }
  function back() {
    setResult(storeCurrent());
    if (step > 0) setStep(step - 1);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 0 : "2rem" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: isMobile ? 0 : 10, width: isMobile ? "100vw" : "min(680px, 96vw)", maxHeight: isMobile ? "100dvh" : "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "1rem 1.5rem", borderBottom: `1px solid ${BORDER}` }}>
          <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", margin: 0, color: TEXT_DARK }}>Set crops</p>
          <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: "0.25rem 0 0" }}>
            Step {step + 1} of {CROP_RATIOS.length} · {ratio.key} — {ratio.label}
          </p>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "1.25rem", display: "flex", justifyContent: "center", alignItems: "center", background: "#f4f4f5" }}>
          <div style={{ position: "relative", lineHeight: 0, touchAction: "none", userSelect: "none" }}
               onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={src} alt="" onLoad={measure}
                 style={{ display: "block", maxWidth: isMobile ? "88vw" : "560px", maxHeight: isMobile ? "60vh" : "440px", width: "auto", height: "auto" }} draggable={false} />
            {box && (
              <>
                {/* dim outside the crop */}
                <div style={{ position: "absolute", inset: 0, boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`, clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.left}px ${box.top}px, ${box.left}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top}px, ${box.left}px ${box.top}px)`, pointerEvents: "none" }} />
                <div
                  onPointerDown={e => onPointerDown(e, "move")}
                  style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, border: `2px solid #fff`, boxShadow: "0 0 0 1px rgba(0,0,0,0.4)", cursor: "move", boxSizing: "border-box" }}
                >
                  <div
                    onPointerDown={e => onPointerDown(e, "resize")}
                    style={{ position: "absolute", right: -8, bottom: -8, width: 18, height: 18, borderRadius: "50%", background: "#fff", border: `2px solid ${CRIMSON}`, cursor: "nwse-resize" }}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ padding: "0.85rem 1.5rem", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, cursor: "pointer", padding: 0 }}>Cancel</button>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {step > 0 && (
              <button type="button" onClick={back} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.45rem 1.1rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: TEXT_DARK }}>Back</button>
            )}
            <button type="button" onClick={next} style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.45rem 1.3rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
              {step < CROP_RATIOS.length - 1 ? "Next" : "Save crops"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
