import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { setMemberSession } from "@/lib/memberSession";
import { upsertMember, type MemberTier, type MemberStatus } from "@/lib/membership";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");

// Stripe redirects here after a successful subscription checkout. We verify the
// session server-side, sign the member in immediately (so they never touch the
// magic-link email for their first visit), and also upsert the membership as a
// belt-and-suspenders backup to the webhook (idempotent — same doc id). Then we
// bounce to the thank-you page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const done = NextResponse.redirect(`${SITE_URL}/subscribe/success`);

  if (!sessionId) return done;

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Only trust a genuinely-paid subscription checkout.
    if (session.mode !== "subscription" || session.payment_status !== "paid") return done;

    const email = session.customer_details?.email ?? session.customer_email ?? undefined;
    if (!email) return done;

    const tier = (session.metadata?.tier as MemberTier) ?? "monthly";
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    let status: MemberStatus = "active";
    let currentPeriodEnd: number | undefined;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      status = sub.status === "active" || sub.status === "trialing" ? "active" : "incomplete";
      currentPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
    }

    await upsertMember({
      email,
      name: session.customer_details?.name ?? undefined,
      tier,
      status,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
      stripeSubscriptionId: subId,
      currentPeriodEnd,
    });

    await setMemberSession(email);
  } catch {
    // Never block the thank-you page on a verification hiccup — the webhook
    // still records the membership, and they can sign in via magic link.
  }

  return done;
}
