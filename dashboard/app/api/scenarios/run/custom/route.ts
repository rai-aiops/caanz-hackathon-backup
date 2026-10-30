import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

type CustomScenarioRunRequest = {
  payloads?: unknown;
};

const DEFAULT_AGENTS_API_BASE_URL = "http://127.0.0.1:8000";

function getAgentsApiBaseUrl() {
  return (process.env.LOCAL_AGENTS_API_BASE_URL ?? DEFAULT_AGENTS_API_BASE_URL).replace(/\/+$/, "");
}

function formatBackendError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  if ("detail" in payload && typeof payload.detail === "string") return payload.detail;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as CustomScenarioRunRequest;
  if (!Array.isArray(body.payloads) || body.payloads.length === 0) {
    return NextResponse.json(
      { error: "A custom run requires at least one payload." },
      { status: 400 },
    );
  }
  if (body.payloads.some((payload) => !payload || typeof payload !== "object" || Array.isArray(payload))) {
    return NextResponse.json(
      { error: "Every custom payload must be a JSON object." },
      { status: 400 },
    );
  }

  const endpoint = new URL(`${getAgentsApiBaseUrl()}/scenarios/run/custom/stream`);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payloads: body.payloads }),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach the local agents API at ${endpoint.origin}. Start it with: uv run python api.py`,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    return NextResponse.json(
      {
        error: formatBackendError(payload, `Custom payload run failed with status ${response.status}.`),
      },
      { status: response.status },
    );
  }

  if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return NextResponse.json(payload);
}
