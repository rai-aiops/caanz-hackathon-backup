import { createHash } from "crypto";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const cwd = process.cwd();
const dashboardRoot = path.basename(cwd) === "dashboard" ? cwd : path.join(cwd, "dashboard");
const repoRoot = path.basename(cwd) === "dashboard" ? path.dirname(cwd) : cwd;
const contextRoot = path.join(dashboardRoot, "context");
const uploadsRoot = path.join(contextRoot, "uploads");
const generatedRoot = path.join(contextRoot, "generated");
const manifestPath = path.join(contextRoot, "manifest.json");
const combinedContextPath = path.join(contextRoot, "eval-context.md");
const extractorPath = path.join(dashboardRoot, "scripts", "extract_eval_context.py");
const MAX_CONTEXT_CHARS_PER_FILE = 120_000;

const TEXT_EXTENSIONS = new Set([
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".markdown",
  ".py",
  ".text",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export type EvalContextDocument = {
  id: string;
  source_name: string;
  source_path: string;
  generated_path: string;
  mime_type: string;
  size_bytes: number;
  added_at: string;
  content_chars: number;
  image_count: number;
  page_count?: number;
  warning?: string;
};

export type EvalContextConfig = {
  status: "empty" | "ready";
  documents: EvalContextDocument[];
  context_path: string;
  context_chars: number;
};

type EvalContextManifest = {
  documents: EvalContextDocument[];
};

export type UploadedContextFile = {
  name: string;
  type: string;
  buffer: Buffer;
};

type PdfExtraction = {
  page_count: number;
  image_count: number;
  pages_with_images: number[];
  pages: Array<{
    page: number;
    text: string;
    image_count: number;
  }>;
};

type ExtractedContext = {
  markdown: string;
  content_chars: number;
  image_count: number;
  page_count?: number;
  warning?: string;
};

function relativeToRepo(filePath: string) {
  return path.relative(repoRoot, filePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "context-file").slice(0, 160);
}

function createDocumentId(fileName: string, buffer: Buffer) {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const baseName = sanitizeFileName(path.basename(fileName, path.extname(fileName))).slice(0, 80);
  return `${baseName || "context"}-${hash}`;
}

function isTextLikeFile(fileName: string, mimeType: string) {
  const extension = path.extname(fileName).toLowerCase();
  return mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension);
}

function truncateContextText(text: string) {
  if (text.length <= MAX_CONTEXT_CHARS_PER_FILE) {
    return { text, warning: undefined };
  }
  return {
    text: text.slice(0, MAX_CONTEXT_CHARS_PER_FILE),
    warning: `Context text truncated to ${MAX_CONTEXT_CHARS_PER_FILE} characters.`,
  };
}

function formatPageList(pages: number[]) {
  if (pages.length === 0) return "none";
  if (pages.length <= 30) return pages.join(", ");
  return `${pages.slice(0, 30).join(", ")} and ${pages.length - 30} more`;
}

function createContextHeader(file: UploadedContextFile, extractedAt: string) {
  return [
    `# Context: ${file.name}`,
    "",
    `- Source file: ${file.name}`,
    `- MIME type: ${file.type || "unknown"}`,
    `- Size: ${file.buffer.byteLength} bytes`,
    `- Extracted at: ${extractedAt}`,
  ];
}

async function readTextFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readManifest(): Promise<EvalContextManifest> {
  const source = await readTextFile(manifestPath);
  if (!source) return { documents: [] };
  const parsed = JSON.parse(source) as Partial<EvalContextManifest>;
  return { documents: Array.isArray(parsed.documents) ? parsed.documents : [] };
}

async function writeManifest(manifest: EvalContextManifest) {
  await fs.mkdir(contextRoot, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function runPythonPdfExtractor(filePath: string) {
  return new Promise<PdfExtraction>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", extractorPath, filePath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8").trim();
      if (code !== 0) {
        reject(new Error(errorOutput || `PDF extraction failed with exit code ${code}.`));
        return;
      }

      try {
        const parsed = JSON.parse(output) as PdfExtraction | { error?: string };
        if ("error" in parsed && parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed as PdfExtraction);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function extractPdf(filePath: string, file: UploadedContextFile, extractedAt: string): Promise<ExtractedContext> {
  const extraction = await runPythonPdfExtractor(filePath);
  const rawText = extraction.pages
    .map((page) => [`## Page ${page.page}`, "", page.text || "[No extractable text on this page.]"].join("\n"))
    .join("\n\n");
  const truncated = truncateContextText(rawText);
  const imageWarning = extraction.image_count > 0
    ? `Embedded images detected on pages ${formatPageList(extraction.pages_with_images)}. Only extracted text is included in judge context.`
    : undefined;
  const warnings = [imageWarning, truncated.warning].filter(Boolean).join(" ");
  const header = [
    ...createContextHeader(file, extractedAt),
    `- Pages: ${extraction.page_count}`,
    `- Embedded images: ${extraction.image_count}`,
    `- Pages with embedded images: ${formatPageList(extraction.pages_with_images)}`,
  ];

  if (warnings) header.push(`- Extraction note: ${warnings}`);

  return {
    markdown: `${header.join("\n")}\n\n${truncated.text.trim() || "No extractable PDF text found."}\n`,
    content_chars: truncated.text.length,
    image_count: extraction.image_count,
    page_count: extraction.page_count,
    warning: warnings || undefined,
  };
}

function extractText(file: UploadedContextFile, extractedAt: string): ExtractedContext {
  const decoded = file.buffer.toString("utf-8");
  const truncated = truncateContextText(decoded);
  const extension = path.extname(file.name).replace(".", "") || "text";
  const isMarkdown = extension === "md" || extension === "markdown";
  const content = isMarkdown
    ? truncated.text.trim()
    : `\`\`\`${extension}\n${truncated.text.trim()}\n\`\`\``;

  return {
    markdown: `${createContextHeader(file, extractedAt).join("\n")}\n\n## File Content\n\n${content || "[No text content found.]"}\n`,
    content_chars: truncated.text.length,
    image_count: 0,
    warning: truncated.warning,
  };
}

function extractUnsupported(file: UploadedContextFile, extractedAt: string): ExtractedContext {
  const isImage = file.type.startsWith("image/");
  const note = isImage
    ? "Image file detected. The current judge context includes this file manifest only; visual image review is not enabled."
    : "This file type is not text-extractable by the dashboard context extractor.";

  return {
    markdown: `${createContextHeader(file, extractedAt).join("\n")}\n\n## Extraction Note\n\n${note}\n`,
    content_chars: note.length,
    image_count: isImage ? 1 : 0,
    warning: note,
  };
}

async function extractFile(filePath: string, file: UploadedContextFile, extractedAt: string) {
  const extension = path.extname(file.name).toLowerCase();
  if (extension === ".pdf" || file.type === "application/pdf") {
    return extractPdf(filePath, file, extractedAt);
  }
  if (isTextLikeFile(file.name, file.type)) {
    return extractText(file, extractedAt);
  }
  return extractUnsupported(file, extractedAt);
}

async function writeCombinedContext(documents: EvalContextDocument[]) {
  await fs.mkdir(contextRoot, { recursive: true });

  if (documents.length === 0) {
    await fs.writeFile(combinedContextPath, "", "utf-8");
    return;
  }

  const generatedSections = await Promise.all(
    documents.map(async (document) => {
      const source = await readTextFile(path.join(repoRoot, document.generated_path));
      return source?.trim() ?? `# Context: ${document.source_name}\n\nGenerated context file missing.`;
    }),
  );
  const index = documents
    .map((document) => {
      const details = [
        `${document.source_name}`,
        document.page_count ? `${document.page_count} pages` : null,
        document.image_count ? `${document.image_count} images detected` : null,
        document.warning ? "warning" : null,
      ].filter(Boolean).join(" | ");
      return `- ${details}`;
    })
    .join("\n");

  const combined = [
    "# Added Evaluation Context",
    "",
    "The following files were added through the dashboard Evals context manager.",
    "",
    "## Included Files",
    "",
    index,
    "",
    "---",
    "",
    generatedSections.join("\n\n---\n\n"),
    "",
  ].join("\n");

  await fs.writeFile(combinedContextPath, combined, "utf-8");
}

export async function readEvalContextConfig(): Promise<EvalContextConfig> {
  const manifest = await readManifest();
  const context = await readTextFile(combinedContextPath);
  return {
    status: manifest.documents.length ? "ready" : "empty",
    documents: manifest.documents,
    context_path: relativeToRepo(combinedContextPath),
    context_chars: context?.length ?? 0,
  };
}

export async function readEvalContextMarkdown() {
  const config = await readEvalContextConfig();
  if (config.status !== "ready") return "";
  return (await readTextFile(combinedContextPath))?.trim() ?? "";
}

export async function addEvalContextFiles(files: UploadedContextFile[]) {
  if (files.length === 0) throw new Error("Select at least one context file.");

  await fs.mkdir(uploadsRoot, { recursive: true });
  await fs.mkdir(generatedRoot, { recursive: true });

  const manifest = await readManifest();
  const nextDocuments = [...manifest.documents];

  for (const file of files) {
    if (!file.buffer.byteLength) throw new Error(`${file.name} is empty.`);

    const id = createDocumentId(file.name, file.buffer);
    const safeName = sanitizeFileName(file.name);
    const uploadedPath = path.join(uploadsRoot, `${id}-${safeName}`);
    const generatedPath = path.join(generatedRoot, `${id}.md`);
    const extractedAt = new Date().toISOString();

    await fs.writeFile(uploadedPath, file.buffer);
    const extracted = await extractFile(uploadedPath, file, extractedAt);
    await fs.writeFile(generatedPath, extracted.markdown, "utf-8");

    const document: EvalContextDocument = {
      id,
      source_name: file.name,
      source_path: relativeToRepo(uploadedPath),
      generated_path: relativeToRepo(generatedPath),
      mime_type: file.type || "unknown",
      size_bytes: file.buffer.byteLength,
      added_at: extractedAt,
      content_chars: extracted.content_chars,
      image_count: extracted.image_count,
      page_count: extracted.page_count,
      warning: extracted.warning,
    };

    const existingIndex = nextDocuments.findIndex((item) => item.id === id);
    if (existingIndex === -1) nextDocuments.push(document);
    else nextDocuments[existingIndex] = document;
  }

  await writeManifest({ documents: nextDocuments });
  await writeCombinedContext(nextDocuments);
  return readEvalContextConfig();
}

export async function clearEvalContext() {
  await fs.rm(contextRoot, { force: true, recursive: true });
  return readEvalContextConfig();
}
