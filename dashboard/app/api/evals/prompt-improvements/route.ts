import { NextResponse } from "next/server";
import { recommendPromptImprovements } from "@/lib/evalJudge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type PromptImprovementRequest = {
  trace_ids?: string[];
  eval_results?: unknown[];
  judge_model?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTraceIds(body: PromptImprovementRequest) {
  const fromBody = Array.isArray(body.trace_ids) ? body.trace_ids : [];
  const fromResults = Array.isArray(body.eval_results)
    ? body.eval_results
        .map((result) => (isRecord(result) && typeof result.trace_id === "string" ? result.trace_id : null))
        .filter((traceId): traceId is string => Boolean(traceId))
    : [];

  return [...new Set([...fromBody, ...fromResults].filter(Boolean))];
}

export async function POST(request: Request) {
  let body: PromptImprovementRequest;
  try {
    body = (await request.json()) as PromptImprovementRequest;
  } catch {
    return NextResponse.json({ error: "Prompt improvement request body must be valid JSON." }, { status: 400 });
  }

  const evalResults = Array.isArray(body.eval_results) ? body.eval_results : [];
  if (evalResults.length === 0) {
    return NextResponse.json({ error: "Run evals before asking for prompt improvements." }, { status: 400 });
  }

  try {
    const result = await recommendPromptImprovements(evalResults, getTraceIds(body), body.judge_model);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
