import { NextResponse } from "next/server";
import { clearMemberSession } from "@/lib/memberSession";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");

export async function POST() {
  await clearMemberSession();
  return NextResponse.redirect(`${SITE_URL}/account`, { status: 303 });
}
