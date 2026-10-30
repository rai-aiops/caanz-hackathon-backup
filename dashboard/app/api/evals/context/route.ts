import { NextResponse } from "next/server";
import { addEvalContextFiles, clearEvalContext, readEvalContextConfig, type UploadedContextFile } from "@/lib/evalContextStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type UploadLike = {
  name?: unknown;
  type?: unknown;
  arrayBuffer?: unknown;
};

function isUploadLike(value: FormDataEntryValue): value is File {
  const candidate = value as UploadLike;
  return (
    typeof candidate.name === "string"
    && typeof candidate.arrayBuffer === "function"
  );
}

export async function GET() {
  try {
    return NextResponse.json(await readEvalContextConfig());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploads = formData.getAll("files").filter(isUploadLike);
    const files: UploadedContextFile[] = await Promise.all(
      uploads.map(async (file) => ({
        name: file.name,
        type: file.type,
        buffer: Buffer.from(await file.arrayBuffer()),
      })),
    );

    return NextResponse.json(await addEvalContextFiles(files));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await clearEvalContext());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
