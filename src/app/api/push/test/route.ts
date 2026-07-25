import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

// Sends a notification to every registered device, so you can confirm the
// whole chain works without waiting for a real submission to arrive.
export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const result = await sendPush({
    title: "Imago",
    body: "Notifications are working.",
    url: "/admin/imago",
    tag: "test",
  });
  return NextResponse.json({ ok: true, ...result });
}
