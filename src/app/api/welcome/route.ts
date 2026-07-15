import { sqliteGetSingleton } from "@/lib/storage/sqlite";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(sqliteGetSingleton("welcome"));
}
