"use client";

import { useEffect, useState, useTransition } from "react";
import { compMember, revokeMember, deleteMember, syncMembers } from "../memberActions";
import { addSubscriber, removeSubscriber, type Subscriber } from "../newsletterActions";
import { listMembers } from "../memberActions";
import type { Member } from "@/lib/membership";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.55rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT_DARK, outline: "none", background: "white",
};

const TIER_LABEL: Record<string, string> = { monthly: "Monthly", annual: "Annual", founding: "Founding" };
type AddMode = "subscribe" | "monthly" | "annual" | "founding";

function isActiveMember(m: Member): boolean {
  if (m.status !== "active" && m.status !== "trialing") return false;
  if (m.currentPeriodEnd && m.currentPeriodEnd * 1000 < Date.now()) return false;
  return true;
}

// One row per unique email, merging the member record (if any) and the
// subscriber record (if any) — a reader can be either, both, or neither in
// transition, but they're one person and belong in one list.
type Row = { email: string; member?: Member; subscriber?: Subscriber };

export default function AudiencePanel({
  subscribers, setSubscribers, subscribersLoading,
}: {
  subscribers: Subscriber[];
  setSubscribers: (updater: Subscriber[] | ((prev: Subscriber[]) => Subscriber[])) => void;
  subscribersLoading: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<AddMode>("subscribe");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {}).finally(() => setMembersLoading(false));
    // One-time backfill for members created before the subscriber list existed —
    // runs silently in the background so it's never a manual chore.
    syncMembers().catch(() => {});
  }, []);

  function refreshMembers() {
    listMembers().then(setMembers).catch(() => {});
  }

  function add() {
    setError("");
    const clean = email.trim();
    if (!clean) { setError("Enter an email."); return; }
    startTransition(async () => {
      if (mode === "subscribe") {
        const r = await addSubscriber(clean);
        if (!r.ok) { setError(r.error ?? "Failed."); return; }
        setSubscribers(prev => [{ email: clean.toLowerCase(), status: "neutral", createdAt: new Date().toISOString() }, ...prev]);
      } else {
        const r = await compMember(clean, mode);
        if (!r.ok) { setError(r.error ?? "Failed."); return; }
        refreshMembers();
        // Comping also subscribes server-side; reflect it optimistically.
        setSubscribers(prev => prev.some(s => s.email === clean.toLowerCase())
          ? prev
          : [{ email: clean.toLowerCase(), status: "neutral", createdAt: new Date().toISOString() }, ...prev]);
      }
      setEmail("");
    });
  }

  function revoke(m: Member) {
    if (!confirm(`Revoke ${m.email}'s membership?`)) return;
    setMembers(prev => prev.map(x => x._id === m._id ? { ...x, status: "canceled" } : x));
    startTransition(async () => {
      const r = await revokeMember(m.email);
      if (!r.ok) { alert(r.error ?? "Failed."); refreshMembers(); }
    });
  }

  function removeMemberRecord(m: Member) {
    if (!confirm(`Permanently remove ${m.email}'s member record?`)) return;
    setMembers(prev => prev.filter(x => x._id !== m._id));
    startTransition(async () => {
      const r = await deleteMember(m.email);
      if (!r.ok) { alert(r.error ?? "Failed."); refreshMembers(); }
    });
  }

  function removeSub(emailAddr: string) {
    if (!confirm(`Remove ${emailAddr} from the subscriber list?`)) return;
    setSubscribers(prev => prev.filter(s => s.email !== emailAddr));
    removeSubscriber(emailAddr).catch(() => {
      alert("Failed to remove subscriber.");
    });
  }

  const loading = membersLoading || subscribersLoading;

  const rows: Row[] = (() => {
    const byEmail = new Map<string, Row>();
    for (const m of members) {
      const key = m.email.toLowerCase();
      byEmail.set(key, { email: key, member: m });
    }
    for (const s of subscribers) {
      const key = s.email.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) existing.subscriber = s;
      else byEmail.set(key, { email: key, subscriber: s });
    }
    return [...byEmail.values()].sort((a, b) => {
      const da = a.member?.createdAt ?? a.subscriber?.createdAt ?? "";
      const db = b.member?.createdAt ?? b.subscriber?.createdAt ?? "";
      return db.localeCompare(da);
    });
  })();

  const paidCount = members.filter(isActiveMember).length;

  return (
    <div style={{ maxWidth: 720 }}>
      <style>{`@media (max-width: 700px) { .aud-h1 { display: none; } }`}</style>
      <h1 className="aud-h1" style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", color: TEXT_DARK, margin: 0 }}>Subscribers</h1>
      <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0.35rem 0 1.25rem" }}>
        Your subscribers and members, in one list.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.25rem" }}>
        <input
          style={{ ...INPUT, flex: "1 1 240px" }} type="email" placeholder="name@example.com"
          value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
        />
        <select style={INPUT} value={mode} onChange={e => setMode(e.target.value as AddMode)}>
          <option value="subscribe">Subscriber only (free)</option>
          <option value="founding">Comp: Founding</option>
          <option value="annual">Comp: Annual</option>
          <option value="monthly">Comp: Monthly</option>
        </select>
        <button
          onClick={add} disabled={isPending}
          style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.55rem 1.2rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: isPending ? 0.6 : 1 }}
        >
          Add
        </button>
      </div>
      {error && <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: CRIMSON, margin: "-0.75rem 0 1rem" }}>{error}</p>}

      <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: "0 0 0.75rem" }}>
        {rows.length} {rows.length === 1 ? "person" : "people"}{paidCount > 0 ? ` · ${paidCount} paid` : ""}
      </p>

      {loading ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3rem", textAlign: "center" }}>
          <p style={{ fontFamily: FONT, color: TEXT_MUTED, margin: 0 }}>No one yet.</p>
        </div>
      ) : (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, overflow: "hidden" }}>
          {rows.map(row => {
            const m = row.member;
            const active = m ? isActiveMember(m) : false;
            const former = m ? !active : false;
            return (
              <div key={row.email} style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.7rem 1.1rem", borderBottom: `1px solid ${BORDER}`, opacity: former && !row.subscriber ? 0.6 : 1 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontFamily: FONT, fontSize: "0.9rem", fontWeight: 600, color: TEXT_DARK, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.email}</p>
                  {/* One quiet status line. Active is the norm, so only exceptions
                      (canceled, past due, comped) get called out. */}
                  <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: "0.15rem 0 0" }}>
                    {m ? (
                      <span style={{ color: active ? CRIMSON : TEXT_MUTED, fontWeight: 600 }}>
                        {TIER_LABEL[m.tier] ?? m.tier} member
                        {m.comped ? " (comped)" : ""}
                        {!active ? ` · ${m.status === "canceled" ? "Canceled" : m.status === "past_due" ? "Past due" : m.status}` : ""}
                      </span>
                    ) : (
                      <span>{row.subscriber?.status === "inactive" ? "Unsubscribed" : "Subscriber"}</span>
                    )}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  {active && (
                    <button onClick={() => revoke(m!)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: "pointer", color: CRIMSON }}>
                      Revoke
                    </button>
                  )}
                  {former && (
                    <button onClick={() => removeMemberRecord(m!)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: "pointer", color: TEXT_MUTED }}>
                      Remove member
                    </button>
                  )}
                  {row.subscriber && (
                    <button onClick={() => removeSub(row.email)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: "pointer", color: TEXT_MUTED }}>
                      Unsubscribe
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
