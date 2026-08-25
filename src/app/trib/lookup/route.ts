import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/adminAuth";
import { clerkPartySearch } from "@/lib/trib";

export const dynamic = "force-dynamic";

// In-site drill-down for the deed drawer: other Clerk records for a party
// name. Admin-only, and a bare 404 otherwise, same as the page.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return new NextResponse("Not found", { status: 404 });
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    return NextResponse.json(await clerkPartySearch(name));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
