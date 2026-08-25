import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/adminAuth";
import { parseAgendaPage } from "@/lib/trib";

export const dynamic = "force-dynamic";

// Fetches a meeting/agenda page server-side and returns parsed items, so the
// rail can render agendas inline instead of linking out. Host-whitelisted,
// admin-only, bare 404 otherwise.
const ALLOWED = [/(^|\.)hylandcloud\.com$/i, /(^|\.)hcfl\.gov$/i, /(^|\.)granicus\.com$/i, /(^|\.)tampa\.gov$/i, /(^|\.)hillsclerk\.com$/i];

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return new NextResponse("Not found", { status: 404 });
  const url = req.nextUrl.searchParams.get("url") ?? "";
  let host = "";
  try { host = new URL(url).hostname; } catch { return NextResponse.json({ error: "bad url" }, { status: 400 }); }
  if (!ALLOWED.some(re => re.test(host))) return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  try {
    return NextResponse.json(await parseAgendaPage(url));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
