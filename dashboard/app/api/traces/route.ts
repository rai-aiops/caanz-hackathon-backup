import { NextResponse } from "next/server";
import { listTraceSummaries } from "@/lib/traceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const traces = await listTraceSummaries();
  return NextResponse.json({ traces });
}
