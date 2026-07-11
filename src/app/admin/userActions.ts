"use server";

import { requireAdmin, getCurrentUser } from "@/lib/adminAuth";
import { listAllUsers, type FlatplanUser, type UserRole } from "@/lib/users";
import { sanityMutate, uploadUserPhotoAsset } from "@/lib/sanityWrite";
import { straightenQuotes } from "@/lib/straighten";

const sq = (s: string | null | undefined) => (typeof s === "string" ? straightenQuotes(s) : s);

export type UserInput = {
  _id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  byline?: string;
  jobTitle?: string;
  bio?: string;
  photoAssetId?: string;
  role: UserRole;
};

// Admin-only. Returns the full user list for the management panel.
export async function listUsers(): Promise<FlatplanUser[]> {
  await requireAdmin();
  return listAllUsers();
}

// Admin-only. Create or update a user. Email is the identity key (lowercased).
export async function saveUser(input: UserInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "A valid email address is required." };
  }
  if (input.role !== "admin" && input.role !== "editor") {
    return { ok: false, error: "Invalid role." };
  }

  // Deterministic id from the email so the same person can't be added twice.
  const id = input._id || `user-${email.replace(/[^a-z0-9]/g, "-")}`;

  const doc: Record<string, unknown> = {
    _id: id,
    _type: "user",
    email,
    firstName: sq(input.firstName?.trim()) || undefined,
    lastName: sq(input.lastName?.trim()) || undefined,
    byline: sq(input.byline?.trim()) || undefined,
    jobTitle: sq(input.jobTitle?.trim()) || undefined,
    bio: sq(input.bio?.trim()) || undefined,
    role: input.role,
    active: true,
    ...(input.photoAssetId
      ? { photo: { _type: "image", asset: { _type: "reference", _ref: input.photoAssetId } } }
      : {}),
  };

  try {
    await sanityMutate([{ createOrReplace: doc }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Admin-only. Deactivate (revoke access) or reactivate a user. We deactivate
// rather than delete so their byline/history on existing posts is preserved.
// An admin cannot deactivate themselves (prevents self-lockout).
export async function setUserActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  if (id === me._id) return { ok: false, error: "You can't deactivate your own account." };
  try {
    await sanityMutate([{ patch: { id, set: { active } } }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }
}

// Admin-only. Permanently remove a user record. Use deactivate instead when you
// want to preserve their byline/history; this fully deletes the document. An
// admin cannot delete their own account (prevents self-lockout).
export async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  if (id === me._id) return { ok: false, error: "You can't delete your own account." };
  try {
    await sanityMutate([{ delete: { id } }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// Admin-only. Upload a profile photo, returns the asset id to attach via saveUser.
export async function uploadUserPhoto(formData: FormData): Promise<{ assetId: string; url: string }> {
  await requireAdmin();
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");
  return uploadUserPhotoAsset(file);
}

// The signed-in person's own record (role, name) for gating the UI.
export async function getMe(): Promise<FlatplanUser | null> {
  return getCurrentUser();
}
