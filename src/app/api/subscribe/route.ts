import { NextRequest, NextResponse } from "next/server";


import { sanityMutate } from "@/lib/sanityWrite";

// Routed through the shared helper (Sanity or local sqlite per STORAGE_BACKEND).
async function mutate(mutations: unknown[]) {
  return sanityMutate(mutations);
}

// Deterministic id per email so the same address can't subscribe twice.
function subscriberId(email: string) {
  return "subscriber-" + email.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

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
        // createIfNotExists, not createOrReplace — resubscribing shouldn't
        // reset an already-active subscriber's status back to "neutral".
        createIfNotExists: {
          _id: subscriberId(email),
          _type: "subscriber",
          email: email.toLowerCase(),
          // Starts "neutral" — only flips to "active" once they regularly open
          // emails (see /api/track-open), so the dashboard's "Active" count
          // reflects actually-engaged subscribers, not just signups.
          status: "neutral",
          createdAt: new Date().toISOString(),
        },
      },
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
