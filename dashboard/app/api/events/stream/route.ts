import { subscribeTraceEvents } from "@/lib/eventBus";
import type { TraceEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSse(event: TraceEvent) {
  return `event: trace-event\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTraceId = url.searchParams.get("trace_id");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: TraceEvent) => {
        if (requestedTraceId && event.trace_id !== requestedTraceId) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          return;
        }
      };

      send({
        type: "connected",
        timestamp: new Date().toISOString(),
        trace_id: requestedTraceId ?? undefined,
        source: "dashboard",
      });

      const unsubscribe = subscribeTraceEvents(send);
      const heartbeat = setInterval(() => {
        send({
          type: "heartbeat",
          timestamp: new Date().toISOString(),
          trace_id: requestedTraceId ?? undefined,
          source: "dashboard",
        });
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
