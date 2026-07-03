import { sanityMutate } from "./sanityWrite";

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
  const query = encodeURIComponent(`*[_id == "${id}"][0]{ _id, email, tier, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, createdAt }`);
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
  ]);
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
