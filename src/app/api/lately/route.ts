import { getLately } from "@/lib/content";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const lately = await getLately();
    return NextResponse.json(lately ?? null);
  } catch {
    return NextResponse.json(null);
  }
}
