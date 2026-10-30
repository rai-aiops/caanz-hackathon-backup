import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AGENTS_API_BASE_URL = "http://127.0.0.1:8000";

function getAgentsApiBaseUrl() {
  return (process.env.LOCAL_AGENTS_API_BASE_URL ?? DEFAULT_AGENTS_API_BASE_URL).replace(/\/+$/, "");
}

function formatBackendError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  if ("detail" in payload && typeof payload.detail === "string") return payload.detail;
  return fallback;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ticketId = requestUrl.searchParams.get("ticket_id")?.trim();
  if (!ticketId || !/^FS-\d+$/.test(ticketId)) {
    return NextResponse.json({ error: "A Freshservice ticket ID is required (FS-...)." }, { status: 400 });
  }
  const endpoint = new URL(`${getAgentsApiBaseUrl()}/runs/context`);
  endpoint.searchParams.set("ticket_id", ticketId);

  let response: Response;
  try {
    response = await fetch(endpoint, { cache: "no-store" });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach the local agents API at ${endpoint.origin}. Start it with: uv run python api.py`,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return NextResponse.json(
      {
        error: formatBackendError(payload, `Run context read failed with status ${response.status}.`),
      },
      { status: response.status },
    );
  }

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
