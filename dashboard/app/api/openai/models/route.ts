import { NextResponse } from "next/server";
import { getJudgeModelOptions } from "@/lib/judgeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getJudgeModelOptions());
}
