import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sqliteRecordMeterRead } from "@/lib/storage/sqlite";
import { METER_COOKIE, meterMonth } from "@/lib/meter";

// Records a metered (non-member) read of a members-only story. Called by the
// client after a metered view renders, so the count reflects real reads.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { slug } = await req.json().catch(() => ({ slug: "" }));
  if (!slug || typeof slug !== "string") return NextResponse.json({ ok: false }, { status: 400 });
  const id = (await cookies()).get(METER_COOKIE)?.value;
  if (id) sqliteRecordMeterRead(id, slug, meterMonth());
  return NextResponse.json({ ok: true });
}
