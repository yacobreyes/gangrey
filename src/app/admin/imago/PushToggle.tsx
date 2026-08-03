"use client";
import { useEffect, useState } from "react";

const CRIMSON = "#490000";
const CARD_LINE = "#e9e4dd";
const TEXT_DARK = "#1a1a1a";
const FONT = "var(--font-subhead)";

// The push service wants the VAPID key as bytes, not base64url. Backed by an
// explicit ArrayBuffer so it satisfies BufferSource (a plain Uint8Array is
// typed over ArrayBufferLike, which includes SharedArrayBuffer).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "denied" | "needs-install";

/**
 * Turns notifications on for THIS device. Each device subscribes separately,
 * which is why this reads "this device" rather than presenting as an account
 * setting.
 */
export default function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;

      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // iOS only exposes push to a site installed to the home screen, so tell
        // the user how to get it rather than calling it unsupported.
        const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches
          || (window.navigator as { standalone?: boolean }).standalone === true;
        setState(iOS && !standalone ? "needs-install" : "unsupported");
        return;
      }

      const res = await fetch("/api/push/subscribe").then(r => r.json()).catch(() => null);
      if (!res?.configured) { setState("unconfigured"); return; }

      if (Notification.permission === "denied") { setState("denied"); return; }

      const reg = await navigator.serviceWorker.getRegistration();
      const existing = reg ? await reg.pushManager.getSubscription() : null;
      setState(existing ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true); setNote("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }

      const { publicKey } = await fetch("/api/push/subscribe").then(r => r.json());
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 80) }),
      });
      if (!r.ok) throw new Error("Could not save this device");
      setState("on");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not turn notifications on");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setNote("");
    const r = await fetch("/api/push/test", { method: "POST" }).then(x => x.json()).catch(() => null);
    setNote(r?.sent ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` : "Nothing was sent.");
    setBusy(false);
  }

  // Render nothing until push is actually usable. "Not set up yet" was just
  // clutter in the app: configuring the keys is a server job done from a
  // terminal, so the panel has no business nagging about it here. The card
  // appears once the server has keys, as the on/off toggle it's meant to be.
  if (state === "loading" || state === "unsupported" || state === "unconfigured") return null;

  const card: React.CSSProperties = {
    background: "white", border: `1px solid ${CARD_LINE}`, borderRadius: 14,
    padding: "0.9rem 1rem", marginTop: 18,
  };
  const title: React.CSSProperties = {
    fontFamily: FONT, fontSize: "0.94rem", fontWeight: 700, color: TEXT_DARK, margin: 0,
  };
  const sub: React.CSSProperties = {
    fontFamily: FONT, fontSize: "0.78rem", color: "#7a6f68", margin: "0.25rem 0 0", lineHeight: 1.45,
  };
  const btn: React.CSSProperties = {
    fontFamily: FONT, fontSize: "0.82rem", fontWeight: 600, borderRadius: 20,
    padding: "0.4rem 0.95rem", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };

  return (
    <div style={card}>
      <p style={title}>Notifications</p>

      {state === "needs-install" && (
        <p style={sub}>
          To get notifications on iPhone, add Imago to your home screen first: tap
          Share, then Add to Home Screen, and open it from there.
        </p>
      )}

      {state === "denied" && (
        <p style={sub}>
          Notifications are blocked for this site. Allow them in your browser or
          iPhone settings, then come back.
        </p>
      )}

      {(state === "off" || state === "on") && (
        <>
          <p style={sub}>
            {state === "on"
              ? "On for this device. You'll hear about submissions, failed payments, and scheduled sends."
              : "Get told when a submission arrives, a payment fails, or a scheduled send goes out, without opening Imago."}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {state === "off" ? (
              <button type="button" disabled={busy} onClick={enable}
                style={{ ...btn, background: CRIMSON, color: "white", border: "none" }}>
                {busy ? "Turning on…" : "Turn on for this device"}
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={test}
                  style={{ ...btn, background: CRIMSON, color: "white", border: "none" }}>
                  Send a test
                </button>
                <button type="button" disabled={busy} onClick={disable}
                  style={{ ...btn, background: "white", color: CRIMSON, border: `1px solid ${CARD_LINE}` }}>
                  Turn off
                </button>
              </>
            )}
          </div>
        </>
      )}

      {note && <p style={{ ...sub, color: CRIMSON }}>{note}</p>}
    </div>
  );
}
