"use client";

import { useEffect, useState, useTransition } from "react";
import { listMembers, compMember, revokeMember } from "../memberActions";
import type { Member } from "@/lib/membership";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.55rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT_DARK, outline: "none", background: "white",
};

const TIER_LABEL: Record<string, string> = { monthly: "Monthly", annual: "Annual", founding: "Founding" };

function isActive(m: Member): boolean {
  if (m.status !== "active" && m.status !== "trialing") return false;
  if (m.currentPeriodEnd && m.currentPeriodEnd * 1000 < Date.now()) return false;
  return true;
}

export default function MembersPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<"monthly" | "annual" | "founding">("founding");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function refresh() {
    listMembers().then(setMembers).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(refresh, []);

  function comp() {
    setError("");
    if (!email.trim()) { setError("Enter an email."); return; }
    startTransition(async () => {
      const r = await compMember(email.trim(), tier);
      if (!r.ok) { setError(r.error ?? "Failed."); return; }
      setEmail("");
      refresh();
    });
  }

  function revoke(m: Member) {
    if (!confirm(`Revoke ${m.email}'s access?`)) return;
    setMembers(prev => prev.map(x => x._id === m._id ? { ...x, status: "canceled" } : x));
    startTransition(async () => {
      const r = await revokeMember(m.email);
      if (!r.ok) { alert(r.error ?? "Failed."); refresh(); }
    });
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0 0 1.25rem" }}>
        Paid members are added automatically after checkout. Comp a free membership below — they sign in with the same email (magic link) and get full access.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.5rem" }}>
        <input
          style={{ ...INPUT, flex: "1 1 240px" }} type="email" placeholder="email to comp"
          value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") comp(); }}
        />
        <select style={INPUT} value={tier} onChange={e => setTier(e.target.value as typeof tier)}>
          <option value="founding">Founding</option>
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
        </select>
        <button
          onClick={comp} disabled={isPending}
          style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.55rem 1.2rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: isPending ? 0.6 : 1 }}
        >
          Comp membership
        </button>
      </div>
      {error && <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: CRIMSON, margin: "0 0 1rem" }}>{error}</p>}

      {loading ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
      ) : members.length === 0 ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3rem", textAlign: "center" }}>
          <p style={{ fontFamily: FONT, color: TEXT_MUTED, margin: 0 }}>No members yet.</p>
        </div>
      ) : (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, overflow: "hidden" }}>
          {members.map(m => {
            const active = isActive(m);
            return (
              <div key={m._id} style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.75rem 1.1rem", borderBottom: `1px solid ${BORDER}`, opacity: active ? 1 : 0.55 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontFamily: FONT, fontSize: "0.9rem", fontWeight: 600, color: TEXT_DARK, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email}</p>
                  <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: 0 }}>
                    {TIER_LABEL[m.tier] ?? m.tier} · {active ? "Active" : m.status}{m.comped ? " · Comped" : ""}
                  </p>
                </div>
                {active && (
                  <button onClick={() => revoke(m)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: "pointer", color: CRIMSON, flexShrink: 0 }}>
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
