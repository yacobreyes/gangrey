import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { pushConfigured, pushPublicKey, savePushSubscription, removePushSubscription, listPushSubscriptions } from "@/lib/push";

export const dynamic = "force-dynamic";

// The browser needs the VAPID public key before it can subscribe, plus whether
// this device is already registered (so the toggle renders in the right state).
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: pushPublicKey(),
    devices: listPushSubscriptions().length,
  });
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    label?: string;
  } | null;

  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  savePushSubscription(
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    user.email,
    body?.label,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const { endpoint } = await req.json().catch(() => ({})) as { endpoint?: string };
  if (endpoint) removePushSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
