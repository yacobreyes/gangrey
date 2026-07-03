import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { SUBSCRIPTION_CATALOG, MERCH_CATALOG, type SubscriptionItem, type MerchItem } from "@/lib/checkoutCatalog";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";

export async function POST(req: Request) {
  let body: { kind?: string; item?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { kind, item } = body;

  try {
    const stripe = getStripe();

    if (kind === "subscription") {
      const catalogItem = SUBSCRIPTION_CATALOG[item as SubscriptionItem];
      if (!catalogItem) return NextResponse.json({ error: "Unknown membership tier." }, { status: 400 });

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: catalogItem.name },
            unit_amount: catalogItem.amount,
            recurring: { interval: catalogItem.interval },
          },
          quantity: 1,
        }],
        // Tier travels on both the session and the subscription so the webhook
        // can record which membership was purchased on every lifecycle event.
        metadata: { tier: item as string },
        subscription_data: { metadata: { tier: item as string } },
        success_url: `${SITE_URL}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/subscribe`,
      });
      return NextResponse.json({ url: session.url });
    }

    if (kind === "merch") {
      const catalogItem = MERCH_CATALOG[item as MerchItem];
      if (!catalogItem) return NextResponse.json({ error: "Unknown product." }, { status: 400 });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: catalogItem.name },
            unit_amount: catalogItem.amount,
          },
          quantity: 1,
        }],
        shipping_address_collection: { allowed_countries: ["US", "CA"] },
        success_url: `${SITE_URL}/store/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/store`,
      });
      return NextResponse.json({ url: session.url });
    }

    return NextResponse.json({ error: "Unknown checkout kind." }, { status: 400 });
  } catch (err) {
    // Most likely cause during setup: STRIPE_SECRET_KEY isn't configured yet.
    const message = err instanceof Error ? err.message : "Checkout failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
