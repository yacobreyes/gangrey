"use server";

import { requireAuth } from "@/lib/adminAuth";
import { fullName } from "@/lib/users";
import { sqliteMutate, sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";

// A lock is considered live only if it was refreshed within this window. The
// editor heartbeats every ~20s, so 45s tolerates a missed beat before a lock is
// treated as abandoned (e.g. the holder closed the tab without releasing).
const LOCK_TTL_MS = 30_000;

export type LockHolder = { name: string; email: string; sessionId: string; since: string };
// selfOtherTab: the lock is held by *you*, but from a different tab/session.
export type LockState = { held: boolean; holder: LockHolder | null; selfOtherTab?: boolean };

type LockDoc = { _id: string; targetId: string; holderName: string; holderEmail: string; sessionId: string; heartbeatAt: string; since: string };

const lockId = (targetId: string) => `lock-${targetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
const isLive = (l: { heartbeatAt?: string } | null, nowMs: number) =>
  !!l?.heartbeatAt && nowMs - new Date(l.heartbeatAt).getTime() < LOCK_TTL_MS;
const toHolder = (l: LockDoc): LockHolder => ({ name: l.holderName, email: l.holderEmail, sessionId: l.sessionId, since: l.since });

async function readLock(targetId: string): Promise<LockDoc | null> {
  return sqliteGetDoc<LockDoc>(lockId(targetId));
}

// Try to take/hold the lock for this editing session. force=true seizes it from
// whoever currently holds it (the "take over" / "kick them out" action).
export async function claimLock(targetId: string, sessionId: string, nowIso: string, force = false): Promise<LockState> {
  const me = await requireAuth();
  const now = new Date(nowIso).getTime();
  const existing = await readLock(targetId);
  const live = isLive(existing, now);

  // Someone else is actively in it and we're not forcing — report who.
  if (live && existing && existing.sessionId !== sessionId && !force) {
    return { held: false, holder: toHolder(existing), selfOtherTab: existing.holderEmail === me.email };
  }

  const since = live && existing?.sessionId === sessionId ? existing.since : nowIso;
  await sqliteMutate([{
    createOrReplace: {
      _id: lockId(targetId), _type: "editLock", targetId,
      holderName: fullName(me), holderEmail: me.email, sessionId,
      heartbeatAt: nowIso, since,
    },
  }]);
  return { held: true, holder: { name: fullName(me), email: me.email, sessionId, since } };
}

// Keep a held lock alive. Returns held:false (with the new holder) if it was
// taken over while we weren't looking, so the editor can drop to read-only.
export async function heartbeatLock(targetId: string, sessionId: string, nowIso: string): Promise<LockState> {
  const me = await requireAuth();
  const now = new Date(nowIso).getTime();
  const existing = await readLock(targetId);
  if (existing && existing.sessionId === sessionId) {
    await sqliteMutate([{ patch: { id: lockId(targetId), set: { heartbeatAt: nowIso } } }]);
    return { held: true, holder: toHolder({ ...existing, heartbeatAt: nowIso }) };
  }
  if (isLive(existing, now) && existing) return { held: false, holder: toHolder(existing), selfOtherTab: existing.holderEmail === me.email };
  return { held: false, holder: null };
}

export async function releaseLock(targetId: string, sessionId: string): Promise<void> {
  await requireAuth();
  const existing = await readLock(targetId);
  if (existing && existing.sessionId === sessionId) {
    try { await sqliteMutate([{ delete: { id: lockId(targetId) } }]); } catch {}
  }
}

// Read the current lock without claiming it — used by view-mode watchers so
// they can see who's editing without grabbing the lock themselves.
export async function watchLock(targetId: string, nowIso: string): Promise<LockState> {
  const me = await requireAuth();
  const now = new Date(nowIso).getTime();
  const existing = await readLock(targetId);
  const live = isLive(existing, now);
  if (live && existing) {
    return { held: false, holder: toHolder(existing), selfOtherTab: existing.holderEmail === me.email };
  }
  return { held: false, holder: null };
}

// All currently-live locks, as { targetId: holder }, for dashboard presence.
export async function getActiveLocks(nowIso: string): Promise<Record<string, LockHolder>> {
  await requireAuth();
  const now = new Date(nowIso).getTime();
  const locks: LockDoc[] = sqliteDocsByType<LockDoc>("editLock");
  const out: Record<string, LockHolder> = {};
  for (const l of locks ?? []) {
    if (isLive(l, now)) out[l.targetId] = toHolder(l);
  }
  return out;
}
