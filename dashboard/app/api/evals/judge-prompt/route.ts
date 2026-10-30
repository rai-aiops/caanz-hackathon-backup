import { NextResponse } from "next/server";
import { readJudgePromptConfig, saveJudgePrompt } from "@/lib/judgePromptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JudgePromptRequest = {
  prompt?: unknown;
};

export async function GET() {
  try {
    return NextResponse.json(await readJudgePromptConfig());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let body: JudgePromptRequest;
  try {
    body = (await request.json()) as JudgePromptRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body.prompt !== "string") {
    return NextResponse.json({ error: "Request body must include a string prompt." }, { status: 400 });
  }

  try {
    return NextResponse.json(await saveJudgePrompt(body.prompt));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
