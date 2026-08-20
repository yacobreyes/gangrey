import { NextRequest, NextResponse } from "next/server";

import { sqliteMutate } from "@/lib/storage/sqlite";
import { rateLimit } from "@/lib/rateLimit";

async function mutate(mutations: unknown[]) {
  return sqliteMutate(mutations);
}

// Deterministic id per email so the same address can't subscribe twice.
function subscriberId(email: string) {
  return "subscriber-" + email.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "subscribe", 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

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
    // Known already? Then this is a resubscribe: keep it idempotent and send
    // no second welcome.
    const { sqliteGetDoc } = await import("@/lib/storage/sqlite");
    const existed = Boolean(sqliteGetDoc(subscriberId(email)));

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

    if (!existed) {
      // Fire-and-forget: the signup is already stored, and a welcome email
      // failing must not turn a successful subscribe into an error.
      const { sendWelcomeEmail } = await import("@/lib/welcomeEmail");
      void sendWelcomeEmail(email.toLowerCase()).catch(e =>
        console.log(`[subscribe] welcome email failed: ${e instanceof Error ? e.message : e}`));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
