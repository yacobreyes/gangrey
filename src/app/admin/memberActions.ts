"use server";

import { requireAdmin } from "@/lib/adminAuth";
import { listAllMembers, compMembership, revokeMembership, type Member, type MemberTier } from "@/lib/membership";

export async function listMembers(): Promise<Member[]> {
  await requireAdmin();
  return listAllMembers();
}

export async function compMember(email: string, tier: MemberTier = "founding"): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  try {
    await compMembership(clean, tier);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't comp membership." };
  }
}

export async function revokeMember(email: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await revokeMembership(email);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't revoke membership." };
  }
}
