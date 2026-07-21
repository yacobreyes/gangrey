import type { LatelyContent } from "@/lib/content";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

function MaybeLink({ url, children }: { url?: string; children: React.ReactNode }) {
  if (!url) return <>{children}</>;
  const href = url.startsWith("http") ? url : `https://${url}`;
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#490000", textDecoration: "underline" }}>{children}</a>;
}

const FONT = "var(--font-subhead)";

const ROW_LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.62rem", fontWeight: 700,
  letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED,
  paddingTop: "0.1rem", minWidth: 68,
};
const ROW_VALUE: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.85rem", color: TEXT_DARK, lineHeight: 1.4,
};

export default function Lately({ data }: { data: LatelyContent | null }) {
  if (!data || (!data.reading && !data.listening && !data.watching)) return null;

  return (
    <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ padding: "0.5rem 0.85rem", borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "0.65rem", letterSpacing: "0.12em", textTransform: "uppercase", color: CRIMSON }}>Lately</span>
      </div>

      <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {data.reading && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <span style={ROW_LABEL}>Reading</span>
            <span style={ROW_VALUE}>
              &quot;<MaybeLink url={data.readingUrl}>{data.reading}</MaybeLink>{data.readingAuthor ? "," : ""}&quot;{data.readingAuthor ? ` ${data.readingAuthor}` : ""}
            </span>
          </div>
        )}

        {data.listening && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <span style={ROW_LABEL}>Listening</span>
            <span style={ROW_VALUE}>
              &quot;<MaybeLink url={data.listeningUrl}>{data.listening}</MaybeLink>{data.listeningArtist ? "," : ""}&quot;{data.listeningArtist ? ` ${data.listeningArtist}` : ""}
            </span>
          </div>
        )}

        {data.watching && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <span style={ROW_LABEL}>Watching</span>
            <span style={ROW_VALUE}><MaybeLink url={data.watchingUrl}>{data.watching}</MaybeLink></span>
          </div>
        )}
      </div>
    </div>
  );
}
