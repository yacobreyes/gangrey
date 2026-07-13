"use client";

import { useState, useEffect, useTransition } from "react";
import { listUsers, saveUser, setUserActive, deleteUser, uploadUserPhoto, type UserInput } from "../userActions";
import type { FlatplanUser, UserRole } from "@/lib/users";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.55rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%",
  boxSizing: "border-box", color: TEXT_DARK, outline: "none", background: "white",
};
const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, color: TEXT_MUTED,
  letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "0.3rem",
};

type Draft = {
  _id?: string;
  firstName: string; lastName: string; email: string;
  byline: string; jobTitle: string; bio: string;
  role: UserRole; photoAssetId?: string; photoUrl?: string;
};

const EMPTY: Draft = { firstName: "", lastName: "", email: "", byline: "", jobTitle: "", bio: "", role: "editor" };

export default function UsersPanel({ currentEmail, initialUsers = [] }: { currentEmail: string; initialUsers?: FlatplanUser[] }) {
  const [users, setUsers] = useState<FlatplanUser[]>(initialUsers);
  // Seeded from the server render, so only show the loading state if we arrived
  // with nothing.
  const [loading, setLoading] = useState(initialUsers.length === 0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function refresh() {
    listUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false));
  }
  // Refresh in the background to pick up changes; seeded data shows immediately.
  useEffect(refresh, []);

  function openNew() { setError(""); setDraft({ ...EMPTY }); }
  function openEdit(u: FlatplanUser) {
    setError("");
    setDraft({
      _id: u._id, firstName: u.firstName ?? "", lastName: u.lastName ?? "", email: u.email,
      byline: u.byline ?? "", jobTitle: u.jobTitle ?? "", bio: u.bio ?? "",
      role: u.role, photoUrl: u.photoUrl,
    });
  }

  async function handlePhoto(file: File | null | undefined) {
    if (!file || !draft) return;
    if (!file.type.startsWith("image/")) { alert("Please choose an image file."); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.set("file", file);
      const { assetId, url } = await uploadUserPhoto(fd);
      setDraft(d => d ? { ...d, photoAssetId: assetId, photoUrl: url } : d);
    } catch { alert("Photo upload failed."); }
    finally { setUploading(false); }
  }

  function save() {
    if (!draft) return;
    setError("");
    const input: UserInput = {
      _id: draft._id, email: draft.email, firstName: draft.firstName, lastName: draft.lastName,
      byline: draft.byline, jobTitle: draft.jobTitle, bio: draft.bio, role: draft.role,
      photoAssetId: draft.photoAssetId,
    };
    startTransition(async () => {
      const r = await saveUser(input);
      if (!r.ok) { setError(r.error ?? "Save failed."); return; }
      setDraft(null);
      refresh();
    });
  }

  function toggleActive(u: FlatplanUser) {
    if (u.email === currentEmail) return;
    startTransition(async () => {
      const r = await setUserActive(u._id, !u.active);
      if (!r.ok) { alert(r.error ?? "Update failed."); return; }
      refresh();
    });
  }

  function removeUser(u: FlatplanUser) {
    if (u.email === currentEmail) return;
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
    if (!confirm(`Delete ${name}? This removes their account entirely and can't be undone.`)) return;
    // Optimistically drop the row so it disappears immediately instead of lingering.
    setUsers(prev => prev.filter(x => x._id !== u._id));
    startTransition(async () => {
      const r = await deleteUser(u._id);
      if (!r.ok) { alert(r.error ?? "Delete failed."); refresh(); }
    });
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <style>{`@media (max-width: 700px) { .usr-h1 { display: none; } }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <h1 className="usr-h1" style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", color: TEXT_DARK, margin: 0 }}>Users</h1>
          <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0.35rem 0 0" }}>
            People who can sign in to imago. Admins can manage users; editors can write and publish.
          </p>
        </div>
        <button onClick={openNew} style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.45rem 1.1rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add user</button>
      </div>

      {loading ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
      ) : users.length === 0 ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3rem", textAlign: "center" }}>
          <p style={{ fontFamily: FONT, color: TEXT_MUTED, margin: 0 }}>No users yet. Add your team.</p>
        </div>
      ) : (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, overflow: "hidden" }}>
          {users.map(u => (
            <div key={u._id} style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.75rem 1.1rem", borderBottom: `1px solid ${BORDER}`, opacity: u.active ? 1 : 0.5 }}>
              {u.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={u.photoUrl} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e9e9ea", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 700, color: TEXT_MUTED }}>{(u.firstName?.[0] ?? u.email[0] ?? "?").toUpperCase()}</div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontFamily: FONT, fontSize: "0.9rem", fontWeight: 600, color: TEXT_DARK, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                  {u.email === currentEmail && <span style={{ color: TEXT_MUTED, fontWeight: 400 }}> · you</span>}
                </p>
                <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</p>
              </div>
              <span style={{ fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: u.role === "admin" ? CRIMSON : TEXT_MUTED, flexShrink: 0 }}>{u.role}{!u.active ? " · off" : ""}</span>
              <button onClick={() => openEdit(u)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: "pointer", color: TEXT_DARK, flexShrink: 0 }}>Edit</button>
              <button onClick={() => toggleActive(u)} disabled={u.email === currentEmail}
                style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.25rem 0.75rem", fontFamily: FONT, fontSize: "0.72rem", cursor: u.email === currentEmail ? "not-allowed" : "pointer", color: u.active ? CRIMSON : TEXT_MUTED, flexShrink: 0, opacity: u.email === currentEmail ? 0.4 : 1 }}>
                {u.active ? "Deactivate" : "Reactivate"}
              </button>
              <button onClick={() => removeUser(u)} disabled={u.email === currentEmail} aria-label="Delete user" title="Delete user"
                style={{ background: "none", border: "none", padding: "0.25rem", fontFamily: FONT, fontSize: "0.72rem", cursor: u.email === currentEmail ? "not-allowed" : "pointer", color: CRIMSON, flexShrink: 0, opacity: u.email === currentEmail ? 0.3 : 1, display: "flex", alignItems: "center" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }} onClick={() => setDraft(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 10, width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "1.5rem 1.75rem" }}>
            <p style={{ fontFamily: FONT, fontSize: "1.05rem", fontWeight: 700, color: TEXT_DARK, margin: "0 0 1.25rem" }}>{draft._id ? "Edit user" : "Add user"}</p>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
              {draft.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={draft.photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#e9e9ea", display: "flex", alignItems: "center", justifyContent: "center", color: TEXT_MUTED }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                  </div>}
              <label style={{ fontFamily: FONT, fontSize: "0.82rem", color: CRIMSON, cursor: "pointer", fontWeight: 600 }}>
                {uploading ? "Uploading…" : "Upload photo"}
                <input type="file" accept="image/*" onChange={e => handlePhoto(e.target.files?.[0])} style={{ display: "none" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ flex: 1 }}><label style={LABEL}>First name</label><input style={INPUT} value={draft.firstName} onChange={e => setDraft({ ...draft, firstName: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label style={LABEL}>Last name</label><input style={INPUT} value={draft.lastName} onChange={e => setDraft({ ...draft, lastName: e.target.value })} /></div>
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={LABEL}>Email <span style={{ color: CRIMSON }}>*</span></label>
              <input style={{ ...INPUT, opacity: draft._id ? 0.6 : 1 }} value={draft.email} disabled={!!draft._id} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" />
              <p style={{ fontFamily: FONT, fontSize: "0.7rem", color: TEXT_MUTED, margin: "0.3rem 0 0" }}>Must match the Google account they sign in with.{draft._id ? " Email can't be changed." : ""}</p>
            </div>
            <div style={{ marginBottom: "1rem" }}><label style={LABEL}>Byline</label><input style={INPUT} value={draft.byline} onChange={e => setDraft({ ...draft, byline: e.target.value })} placeholder="How their name appears on stories" /></div>
            <div style={{ marginBottom: "1rem" }}><label style={LABEL}>Job title</label><input style={INPUT} value={draft.jobTitle} onChange={e => setDraft({ ...draft, jobTitle: e.target.value })} /></div>
            <div style={{ marginBottom: "1rem" }}><label style={LABEL}>Biography</label><textarea style={{ ...INPUT, minHeight: 70, resize: "vertical" }} value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })} /></div>
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={LABEL}>Permission level</label>
              <select style={{ ...INPUT, cursor: draft.email === currentEmail ? "not-allowed" : "pointer" }} value={draft.role} disabled={draft.email === currentEmail} onChange={e => setDraft({ ...draft, role: e.target.value as UserRole })}>
                <option value="editor">Editor — write &amp; publish</option>
                <option value="admin">Admin — write, publish &amp; manage users</option>
              </select>
              {draft.email === currentEmail && <p style={{ fontFamily: FONT, fontSize: "0.7rem", color: TEXT_MUTED, margin: "0.3rem 0 0" }}>You can't change your own permission level.</p>}
            </div>

            {error && <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: CRIMSON, margin: "0 0 0.75rem" }}>{error}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button onClick={() => setDraft(null)} style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.45rem 1.1rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: TEXT_DARK }}>Cancel</button>
              <button onClick={save} disabled={isPending || uploading} style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.45rem 1.2rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", opacity: isPending || uploading ? 0.6 : 1 }}>
                {isPending ? "Saving…" : draft._id ? "Save changes" : "Create user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
