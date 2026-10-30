import { NextResponse } from "next/server";
import { calculateKpis } from "@/lib/kpiMetrics";
import { readRuntimeTickets, RuntimeDataError } from "@/lib/runtimeDataStore";
import { listTraceSummaries, readTrace } from "@/lib/traceStore";
import type { TraceRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tickets, summaries] = await Promise.all([readRuntimeTickets(), listTraceSummaries()]);
    const records = await Promise.all(summaries.filter((summary) => summary.status === "completed")
      .map((summary) => readTrace(summary.trace_id)));
    return NextResponse.json(calculateKpis(tickets, summaries, records.filter((trace): trace is TraceRecord => trace !== null)), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RuntimeDataError ? error.message : "Unable to read KPI data." }, {
      status: error instanceof RuntimeDataError ? error.status : 500,
    });
  }
}
