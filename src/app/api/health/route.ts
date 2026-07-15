import { NextResponse } from "next/server";
import { sqliteGetCount } from "@/lib/storage/sqlite";

// Lightweight liveness + readiness check for an external uptime monitor.
// Returns 200 only if the app is running AND its datastore answers a query;
// 503 otherwise, so a monitor pinging this catches a wedged DB, not just a
// dead process. No auth (contains no sensitive data) and never cached.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Cheapest possible read that proves the SQLite file is open & queryable.
    sqliteGetCount("healthcheck");
    return NextResponse.json(
      { status: "ok", time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "unhealthy" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
