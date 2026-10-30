import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dashboardRoot = path.resolve(/*turbopackIgnore: true*/ process.cwd());
const repoRoot = path.basename(dashboardRoot) === "dashboard"
  ? path.dirname(dashboardRoot)
  : dashboardRoot;
const execFileAsync = promisify(execFile);
const PDF_RENDER_MAX_BUFFER = 24 * 1024 * 1024;
const PDF_RENDER_SCRIPT = `
import sys
from pathlib import Path

import pymupdf

pdf_path = Path(sys.argv[1])
page_number = int(sys.argv[2])
scale = float(sys.argv[3])

with pymupdf.open(pdf_path) as document:
    if page_number < 1 or page_number > document.page_count:
        raise ValueError(f"PDF page {page_number} is outside 1-{document.page_count}.")

    page = document.load_page(page_number - 1)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    sys.stdout.buffer.write(pixmap.tobytes("png"))
`;
const PDF_META_SCRIPT = `
import json
import sys
from pathlib import Path

import pymupdf

pdf_path = Path(sys.argv[1])

with pymupdf.open(pdf_path) as document:
    print(json.dumps({
        "page_count": document.page_count,
        "file_name": pdf_path.name,
        "content_type": "application/pdf",
    }))
`;

const CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function resolveAttachmentPath(requestedPath: string) {
  if (!requestedPath.trim() || requestedPath.includes("\0")) return null;

  const resolved = path.resolve(
    path.isAbsolute(requestedPath) ? requestedPath : path.join(/*turbopackIgnore: true*/ repoRoot, requestedPath),
  );
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  return resolved;
}

function contentTypeFor(filePath: string) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function pythonExecutable() {
  const localPythonCandidates = [
    path.join(/*turbopackIgnore: true*/ repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(/*turbopackIgnore: true*/ repoRoot, ".venv", "bin", "python"),
  ];
  const localPython = localPythonCandidates.find((candidate) => existsSync(candidate));
  if (localPython) return localPython;

  return process.platform === "win32" ? "python" : "python3";
}

function requestedPageNumber(url: URL) {
  const rawPage = url.searchParams.get("page");
  if (!rawPage) return 1;

  const pageNumber = Number(rawPage);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
}

function requestedScale(url: URL) {
  const rawScale = Number(url.searchParams.get("scale") ?? "2");
  if (!Number.isFinite(rawScale)) return 2;
  return Math.min(Math.max(rawScale, 1), 4);
}

async function renderPdfPage(filePath: string, pageNumber: number, scale: number) {
  const { stdout } = await execFileAsync(
    pythonExecutable(),
    ["-c", PDF_RENDER_SCRIPT, filePath, String(pageNumber), String(scale)],
    {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: PDF_RENDER_MAX_BUFFER,
    },
  );
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function readPdfMeta(filePath: string) {
  const { stdout } = await execFileAsync(
    pythonExecutable(),
    ["-c", PDF_META_SCRIPT, filePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get("path");
  if (!requestedPath) {
    return NextResponse.json({ error: "Attachment preview requires a path." }, { status: 400 });
  }

  const resolvedPath = resolveAttachmentPath(requestedPath);
  if (!resolvedPath) {
    return NextResponse.json({ error: "Attachment path is outside the repository." }, { status: 403 });
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Attachment path is not a file." }, { status: 400 });
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    if (extension === ".pdf") {
      if (url.searchParams.get("raw") === "1") {
        const body = await readFile(resolvedPath);
        return new Response(body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `inline; filename="${path.basename(resolvedPath).replaceAll('"', "")}"`,
            "Content-Type": "application/pdf",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.searchParams.get("meta") === "1") {
        return NextResponse.json(await readPdfMeta(resolvedPath));
      }
      const pageNumber = requestedPageNumber(url);
      const scale = requestedScale(url);
      const body = await renderPdfPage(resolvedPath, pageNumber, scale);
      const previewName = `${path.basename(resolvedPath, extension)}-page-${pageNumber}.png`;
      return new Response(body, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="${previewName.replaceAll('"', "")}"`,
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const body = await readFile(resolvedPath);
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${path.basename(resolvedPath).replaceAll('"', "")}"`,
        "Content-Type": contentTypeFor(resolvedPath),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Attachment file was not found." }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
