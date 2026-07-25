import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { upsertMember, updateMemberBySubscription, type MemberTier, type MemberStatus } from "@/lib/membership";
import { notify } from "@/lib/push";

// Stripe requires the raw, unparsed body to verify the webhook signature.
export const runtime = "nodejs";

function normalizeStatus(s: Stripe.Subscription.Status): MemberStatus {
  switch (s) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    default: return "incomplete";
  }
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const stripe = getStripe();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only subscription checkouts create memberships; merch is one-time.
        if (session.mode !== "subscription") break;
        const email = session.customer_details?.email ?? session.customer_email ?? undefined;
        if (!email) break;
        const tier = (session.metadata?.tier as MemberTier) ?? "monthly";
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        let status: MemberStatus = "active";
        let currentPeriodEnd: number | undefined;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          status = normalizeStatus(sub.status);
          currentPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
        }
        await upsertMember({
          email,
          tier,
          status,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
          stripeSubscriptionId: subId,
          currentPeriodEnd,
        });
        notify({
          title: "New member",
          body: `${email} joined (${tier})`,
          url: "/admin/imago/members",
          tag: `member-${email}`,
        });
        break;
      }

      // A card that stops working is silent churn: Stripe just stops
      // collecting and the member lapses without anyone noticing. Surface it
      // the moment it happens so it can be chased.
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const email = invoice.customer_email ?? "a member";
        notify({
          title: "Payment failed",
          body: `${email}. The membership will lapse unless the card is updated.`,
          url: "/admin/imago/members",
          tag: "payment-failed",
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await updateMemberBySubscription({
          stripeSubscriptionId: sub.id,
          status: event.type === "customer.subscription.deleted" ? "canceled" : normalizeStatus(sub.status),
          currentPeriodEnd: (sub as unknown as { current_period_end?: number }).current_period_end,
        });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handler failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
