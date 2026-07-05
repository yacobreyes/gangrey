import { NextRequest, NextResponse } from "next/server";

import { sanityMutate } from "@/lib/sanityWrite";

// Routed through the shared helper (Sanity or local sqlite per STORAGE_BACKEND).
async function mutate(mutations: unknown[]) {
  return sanityMutate(mutations);
}

// Mirrors the deterministic id used when subscribing.
function subscriberId(email: string) {
  return "subscriber-" + email.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

// Flips a subscriber to "unsubscribed" so the send route (which targets
// status == "active") skips them. Uses patch on the deterministic id, so an
// address that was never a subscriber simply no-ops.
export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  try {
    await mutate([
      {
        patch: {
          id: subscriberId(email),
          set: { status: "unsubscribed", unsubscribedAt: new Date().toISOString() },
        },
      },
    ]);
  } catch {
    // Patch fails if the doc doesn't exist — treat as already-not-subscribed.
  }

  return NextResponse.json({ ok: true });
}
