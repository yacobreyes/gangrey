import { sqliteDocsByType } from "./storage/sqlite";

export type UserRole = "admin" | "editor";

export type FlatplanUser = {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  byline?: string;
  jobTitle?: string;
  bio?: string;
  photoUrl?: string;
  role: UserRole;
  active: boolean;
};

// The raw user doc stores the photo as photo.asset._ref (which is the local
// /media/... path — see sqliteSaveMedia). Surface it as photoUrl here, or
// uploaded photos save but never display.
function withPhotoUrl(u: FlatplanUser & { photo?: { asset?: { _ref?: string } } }): FlatplanUser {
  return { ...u, photoUrl: u.photoUrl ?? u.photo?.asset?._ref ?? undefined };
}

// Look up an active user by email (case-insensitive — emails are stored
// lowercased on write). Returns null for unknown or deactivated users.
export async function getUserByEmail(email: string): Promise<FlatplanUser | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  const u = sqliteDocsByType<FlatplanUser>("user").find(x => x.email === e && x.active === true);
  return u ? withPhotoUrl(u) : null;
}

// All users (active and deactivated) for the admin management panel.
export async function listAllUsers(): Promise<FlatplanUser[]> {
  return sqliteDocsByType<FlatplanUser>("user")
    .map(withPhotoUrl)
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.firstName ?? "").localeCompare(b.firstName ?? "") || a.email.localeCompare(b.email));
}

export function fullName(u: { firstName?: string; lastName?: string; email?: string }): string {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || u.email || "Unknown";
}
