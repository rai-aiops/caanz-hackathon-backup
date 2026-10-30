import { NextResponse } from "next/server";
import { publishTraceEvent } from "@/lib/eventBus";
import { appendTraceEvent } from "@/lib/traceStore";
import type { TraceEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Event payload must contain valid JSON." },
      { status: 400 },
    );
  }

  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || typeof (payload as Record<string, unknown>).type !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "Event payload must include a string `type`." },
      { status: 400 },
    );
  }

  const { event, record } = await appendTraceEvent(payload as TraceEvent);
  publishTraceEvent(event);

  return NextResponse.json({ ok: true, trace_id: record.trace_id });
}
