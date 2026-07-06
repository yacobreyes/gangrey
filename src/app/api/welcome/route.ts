import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetSingleton } from "@/lib/storage/sqlite";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isSqliteBackend()) return NextResponse.json(sqliteGetSingleton("welcome"));
  try {
    const doc = await client.fetch(
      `*[_type == "welcome" && _id == "welcome"][0]{ headline, body }`,
      {},
      { cache: "no-store" }
    );
    return NextResponse.json(doc ?? null);
  } catch {
    return NextResponse.json(null);
  }
}
