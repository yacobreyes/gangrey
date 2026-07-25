import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Gangrey | imago",
  // Scoped to Imago so "add to home screen" installs the CMS, not the
  // magazine. Also what lets iOS treat it as a web app, which web push needs.
  manifest: "/imago.webmanifest",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    shortcut: [{ url: "/favicon.png", type: "image/png" }],
  },
};

// Imago is an app, not a reading surface: lock the zoom so a stray pinch can't
// leave the CMS scaled out. Scoped to /admin/imago only, so the public
// magazine keeps pinch-to-zoom for readers.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function ImagoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`html, body { background: #f5f8fa !important; }`}</style>
      {children}
    </>
  );
}
