import { NextResponse } from "next/server";

import { readRuntimeTickets, RuntimeDataError } from "@/lib/runtimeDataStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { tickets: await readRuntimeTickets() },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const status = error instanceof RuntimeDataError ? error.status : 500;
    const message = error instanceof RuntimeDataError
      ? error.message
      : "Unable to read runtime tickets.";
    return NextResponse.json({ error: message }, { status });
  }
}
