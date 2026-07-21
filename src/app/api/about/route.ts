import { getAboutPage } from "@/lib/content";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { parseBody } from "@/lib/parseBody";
import { sqliteSetSingleton } from "@/lib/storage/sqlite";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const about = await getAboutPage();
    return NextResponse.json(about ?? null);
  } catch {
    return NextResponse.json(null);
  }
}

// Save the About page. Handled here (not a Server Action) so the admin page
// doesn't get the automatic router refresh that flashed the whole screen.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const { body: raw } = await req.json() as { body?: string };
  let body: unknown;
  try {
    const parsed = JSON.parse(raw ?? "[]");
    body = Array.isArray(parsed) ? parsed : parseBody(raw ?? "");
  } catch {
    body = parseBody(raw ?? "");
  }
  sqliteSetSingleton("about", { body });
  revalidatePath("/about"); // refresh the public page's cache only
  return NextResponse.json({ ok: true });
}
