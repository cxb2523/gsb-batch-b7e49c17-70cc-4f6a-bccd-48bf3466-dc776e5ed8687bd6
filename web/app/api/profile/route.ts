import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { readJson } from "@/lib/read-json";
import { getProfileData } from "@/lib/profile";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const data = await getProfileData(session.user.id);
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [body, error] = await readJson<{ name?: unknown; role?: unknown }>(request);
  if (error) return error;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : undefined;
  const role = typeof body.role === "string" ? body.role.trim().slice(0, 255) : undefined;

  if (name === undefined && role === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await query(
    `UPDATE users SET name = COALESCE($1, name), role = COALESCE($2, role) WHERE id = $3`,
    [name ?? null, role ?? null, session.user.id]
  );
  return NextResponse.json({ success: true });
}
