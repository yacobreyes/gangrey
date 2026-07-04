import { sanityMutate } from "./sanityWrite";
import { getStripe } from "./stripe";

// Reader memberships are stored as `member` documents in Sanity, keyed
// deterministically by email so the Stripe webhook can upsert idempotently and
// the magic-link login can look a member up by the email they signed in with.

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

// Tokenless CDN read — member docs are non-sensitive membership metadata
// (no card data ever touches Sanity), and this runs on every gated page view.
export async function getMemberByEmail(email: string): Promise<Member | null> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!projectId) return null;
  const id = memberIdForEmail(email);
  const query = encodeURIComponent(`*[_id == "${id}"][0]{ _id, email, tier, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, createdAt, comped }`);
  try {
    const res = await fetch(
      `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.result as Member | null) ?? null;
  } catch {
    return null;
  }
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
  await sanityMutate([
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

// Admin: list every member (comped + Stripe), newest first. Uses the write
// token so drafts/unpublished are visible and reads are always fresh.
export async function listAllMembers(): Promise<Member[]> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  if (!projectId) return [];
  const query = encodeURIComponent(`*[_type == "member"] | order(coalesce(createdAt, "") desc){ _id, email, tier, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, createdAt, comped }`);
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.result as Member[]) ?? [];
}

// Admin: grant a comped membership by email — active, no Stripe subscription.
export async function compMembership(email: string, tier: MemberTier = "founding"): Promise<void> {
  const clean = email.trim().toLowerCase();
  const _id = memberIdForEmail(clean);
  await sanityMutate([
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
  await sanityMutate([{ patch: { id: _id, set: { status: "canceled" } } }]);
}

// Admin: permanently delete a member record (e.g. to clear a canceled row out
// of the panel). Does not touch Stripe — revoke already cancels the sub.
export async function deleteMembership(email: string): Promise<void> {
  const _id = memberIdForEmail(email.trim().toLowerCase());
  await sanityMutate([{ delete: { id: _id } }]);
}

// Update just the status/period on subscription lifecycle events, keyed by the
// Stripe subscription id (which we don't have the email for in every event).
export async function updateMemberBySubscription(input: {
  stripeSubscriptionId: string;
  status: MemberStatus;
  currentPeriodEnd?: number;
}): Promise<void> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!projectId) return;
  const query = encodeURIComponent(`*[_type == "member" && stripeSubscriptionId == "${input.stripeSubscriptionId}"][0]._id`);
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" }
  );
  if (!res.ok) return;
  const { result: id } = await res.json();
  if (!id) return;
  await sanityMutate([
    {
      patch: {
        id,
        set: {
          status: input.status,
          ...(input.currentPeriodEnd ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
        },
      },
    },
  ]);
}
