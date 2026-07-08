import { NextRequest, NextResponse } from "next/server";
import { sqliteDocsByType, sqliteMutate } from "@/lib/storage/sqlite";
import { rateLimit } from "@/lib/rateLimit";

type Score = { _id: string; name: string; score: number };

function topScores(): Score[] {
  return sqliteDocsByType<Score>("leaderboard")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10)
    .map(({ _id, name, score }) => ({ _id, name, score }));
}

export async function GET() {
  try {
    return NextResponse.json({ scores: topScores() });
  } catch {
    return NextResponse.json({ scores: [] });
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "leaderboard", 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json() as { name: string; score: number };
  const name = String(body.name ?? "").trim().slice(0, 20);
  const score = Number(body.score);

  if (!name || !Number.isInteger(score) || score < 1 || score > 9999) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Create a unique doc per submission
  const id = `leaderboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  sqliteMutate([{ createOrReplace: { _id: id, _type: "leaderboard", name, score } }]);

  return NextResponse.json({ scores: topScores() });
}
