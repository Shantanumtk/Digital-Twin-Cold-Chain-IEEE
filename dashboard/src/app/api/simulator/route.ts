import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession();
  const role = (session?.user as any)?.role;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }
  return NextResponse.json({ status: "ok", role });
}
