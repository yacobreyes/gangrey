import { getStripe } from "./stripe";
import { sqliteMutate, sqliteGetDoc, sqliteDocsByType } from "./storage/sqlite";

// Reader memberships are stored as `member` documents, keyed deterministically
// by email so the Stripe webhook can upsert idempotently and the magic-link
// login can look a member up by the email they signed in with.

export type MemberTier = "monthly" | "annual" | "founding";
export type MemberStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

export interface Member {
  _id: string;
  email: string;
  tier: MemberTier;
  status: MemberStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: number; // unix seconds
  createdAt?: string;
  // Comped members are granted access manually (no Stripe subscription).
  comped?: boolean;
}

// Matches the subscriber id scheme in newsletterActions so paid members land
// in the same newsletter list (idempotent createIfNotExists — never clobbers an
// existing subscriber's status or open history).
export function subscriberIdForEmail(email: string): string {
  return "subscriber-" + email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function addSubscriberMutation(email: string) {
  const clean = email.trim().toLowerCase();
  return {
    createIfNotExists: {
      _id: subscriberIdForEmail(clean),
      _type: "subscriber",
      email: clean,
      status: "neutral",
      createdAt: new Date().toISOString(),
    },
  };
}

export function memberIdForEmail(email: string): string {
  return `member-${email.trim().toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
}

// A member counts as "active" if Stripe says the subscription is live and the
// paid period hasn't lapsed. `past_due`/`incomplete`/`canceled` do not unlock
// content. We also honor the period end as a grace guard.
export function isActiveMember(member: Member | null | undefined): boolean {
  if (!member) return false;
  if (member.status !== "active" && member.status !== "trialing") return false;
  if (member.currentPeriodEnd && member.currentPeriodEnd * 1000 < Date.now()) return false;
  return true;
}

export async function getMemberByEmail(email: string): Promise<Member | null> {
  return sqliteGetDoc<Member>(memberIdForEmail(email));
}

// Create/update a member from Stripe webhook data. Idempotent via a fixed _id.
export async function upsertMember(input: {
  email: string;
  tier: MemberTier;
  status: MemberStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: number;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const _id = memberIdForEmail(email);
  // createOrReplace would wipe createdAt; use createIfNotExists + patch so the
  // first-seen timestamp survives status changes.
  await sqliteMutate([
    {
      createIfNotExists: {
        _id,
        _type: "member",
        email,
        createdAt: new Date().toISOString(),
      },
    },
    {
      patch: {
        id: _id,
        set: {
          email,
          tier: input.tier,
          status: input.status,
          ...(input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : {}),
          ...(input.stripeSubscriptionId ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
          ...(input.currentPeriodEnd ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
        },
      },
    },
    // Paid members join the newsletter list too so they're reachable.
    addSubscriberMutation(email),
  ]);
}

// Admin: list every member (comped + Stripe), newest first.
export async function listAllMembers(): Promise<Member[]> {
  return sqliteDocsByType<Member>("member").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// Admin: backfill — add every existing member to the subscriber list. Needed
// once for members created before members were auto-added on join. Idempotent.
export async function syncMembersToSubscribers(): Promise<number> {
  const members = await listAllMembers();
  const muts = members.filter(m => m.email).map(m => addSubscriberMutation(m.email));
  for (let i = 0; i < muts.length; i += 100) {
    await sqliteMutate(muts.slice(i, i + 100));
  }
  return muts.length;
}

// Admin: grant a comped membership by email — active, no Stripe subscription.
export async function compMembership(email: string, tier: MemberTier = "founding"): Promise<void> {
  const clean = email.trim().toLowerCase();
  const _id = memberIdForEmail(clean);
  await sqliteMutate([
    { createIfNotExists: { _id, _type: "member", email: clean, createdAt: new Date().toISOString() } },
    { patch: { id: _id, set: { email: clean, tier, status: "active", comped: true, currentPeriodEnd: null } } },
    addSubscriberMutation(clean),
  ]);
}

// Admin: revoke a member's access (comped or Stripe) by marking canceled.
// If there's a live Stripe subscription behind this member, it must be
// canceled there too — otherwise the next subscription webhook (renewal,
// dunning retry, anything) re-syncs status from Stripe and silently
// resurrects the membership we just revoked.
export async function revokeMembership(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  const _id = memberIdForEmail(clean);
  const member = await getMemberByEmail(clean);
  if (member?.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(member.stripeSubscriptionId);
    } catch (err) {
      // Already canceled/missing on Stripe's side is fine to ignore; anything
      // else should surface so the admin knows the cancel may not have stuck.
      const code = (err as { code?: string })?.code;
      if (code !== "resource_missing") throw err;
    }
  }
  await sqliteMutate([{ patch: { id: _id, set: { status: "canceled" } } }]);
}

// Admin: permanently delete a member record (e.g. to clear a canceled row out
// of the panel). Does not touch Stripe — revoke already cancels the sub.
export async function deleteMembership(email: string): Promise<void> {
  const _id = memberIdForEmail(email.trim().toLowerCase());
  await sqliteMutate([{ delete: { id: _id } }]);
}

// Update just the status/period on subscription lifecycle events, keyed by the
// Stripe subscription id (which we don't have the email for in every event).
export async function updateMemberBySubscription(input: {
  stripeSubscriptionId: string;
  status: MemberStatus;
  currentPeriodEnd?: number;
}): Promise<void> {
  const m = sqliteDocsByType<Member>("member").find(x => x.stripeSubscriptionId === input.stripeSubscriptionId);
  if (!m) return;
  await sqliteMutate([{ patch: { id: m._id, set: { status: input.status, ...(input.currentPeriodEnd ? { currentPeriodEnd: input.currentPeriodEnd } : {}) } } }]);
}
