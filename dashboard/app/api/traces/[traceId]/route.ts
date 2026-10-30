import { NextResponse } from "next/server";
import { deleteTrace, readTrace, saveTraceRunSnapshot } from "@/lib/traceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const params = await context.params;
  const trace = await readTrace(params.traceId);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found." }, { status: 404 });
  }
  return NextResponse.json(trace);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const params = await context.params;
  const result = await deleteTrace(params.traceId);
  if (!result.deleted) {
    return NextResponse.json({ error: "Trace not found." }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const params = await context.params;
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Run snapshot must be a JSON object." }, { status: 400 });
  }

  const snapshot = (payload as Record<string, unknown>).run_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return NextResponse.json({ error: "run_snapshot must be a JSON object." }, { status: 400 });
  }

  const trace = await saveTraceRunSnapshot(params.traceId, snapshot as Record<string, unknown>);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found." }, { status: 404 });
  }
  return NextResponse.json({ trace_id: trace.trace_id, run_snapshot: trace.run_snapshot });
}
