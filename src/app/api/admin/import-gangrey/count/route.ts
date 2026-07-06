import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!projectId) return NextResponse.json({ count: null });

  const query = encodeURIComponent('count(*[_type=="post" && section=="Archive" && status=="published"])');
  try {
    const res = await fetch(
      `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}&returnQuery=false`,
      { cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ count: null });
    const { result } = await res.json();
    return NextResponse.json({ count: result as number });
  } catch {
    return NextResponse.json({ count: null });
  }
}
