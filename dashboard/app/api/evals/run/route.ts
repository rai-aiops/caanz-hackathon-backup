import { NextResponse } from "next/server";
import { buildDynamicJudgeContext, evaluateTraceWithJudge, type EvalJudgeError } from "@/lib/evalJudge";
import { readTrace } from "@/lib/traceStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type EvalRunRequest = {
  trace_ids?: string[];
  judge_model?: string;
  judge_prompt?: string;
};

const EVAL_CONCURRENCY = 4;

async function evaluateOneTrace(
  traceId: string,
  judgeContext: string,
  judgeModel?: string,
) {
  const trace = await readTrace(traceId);
  if (!trace) {
    return { trace_id: traceId, error: "Trace not found." };
  }

  try {
    return await evaluateTraceWithJudge(trace, judgeContext, judgeModel);
  } catch (error) {
    const judgeError = error as EvalJudgeError;
    return {
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
      judge_provider: judgeError.judge_provider,
      judge_model_requested: judgeError.judge_model_requested,
      judge_model_used: judgeError.judge_model_used,
      judge_fallback_used: judgeError.judge_fallback_used,
      judge_api_key_source: judgeError.judge_api_key_source,
      input_tokens: judgeError.input_tokens,
      uncached_input_tokens: judgeError.uncached_input_tokens,
      cached_tokens: judgeError.cached_tokens,
      cache_write_tokens: judgeError.cache_write_tokens,
      output_tokens: judgeError.output_tokens,
      reasoning_tokens: judgeError.reasoning_tokens,
      total_tokens: judgeError.total_tokens,
      input_cost: judgeError.input_cost,
      uncached_input_cost: judgeError.uncached_input_cost,
      cached_input_cost: judgeError.cached_input_cost,
      cache_write_cost: judgeError.cache_write_cost,
      output_cost: judgeError.output_cost,
      reasoning_cost: judgeError.reasoning_cost,
      total_cost: judgeError.total_cost,
      judge_usage: judgeError.judge_usage,
      judge_service_tier: judgeError.judge_service_tier,
    };
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as EvalRunRequest;
  const traceIds = Array.isArray(body.trace_ids) ? body.trace_ids.filter(Boolean) : [];
  if (traceIds.length === 0) {
    return NextResponse.json({ error: "Select at least one trace to evaluate." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const judgeContext = await buildDynamicJudgeContext(body.judge_prompt);
        let nextIndex = 0;

        const worker = async () => {
          while (nextIndex < traceIds.length) {
            const traceId = traceIds[nextIndex];
            nextIndex += 1;
            const result = await evaluateOneTrace(traceId, judgeContext, body.judge_model);
            send({ type: "result", result });
          }
        };

        const workerCount = Math.min(EVAL_CONCURRENCY, traceIds.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        send({ type: "done" });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
