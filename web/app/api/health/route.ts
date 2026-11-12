import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// Never prerendered or cached: the container healthcheck and deploy.sh's public check use this to
// prove the running app can reach Postgres, which /robots.txt (static) cannot.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: noStore });
  }
}
