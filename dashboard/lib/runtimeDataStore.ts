import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfluenceDocument, FreshserviceArticle, FreshserviceTicket, RuntimeData } from "./runtimeDataTypes";

const RUNTIME_DIRECTORY = path.resolve(process.cwd(), "..", "data", "runtime");
type JsonRecord = Record<string, unknown>;

export class RuntimeDataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RuntimeDataError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRuntimeFile(fileName: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path.join(RUNTIME_DIRECTORY, fileName), "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new RuntimeDataError(`Runtime file ${fileName} was not found. Reset runtime data and try again.`, 404);
    }
    throw new RuntimeDataError(`Unable to read runtime file ${fileName}.`, 500);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new RuntimeDataError(`Runtime file ${fileName} contains invalid JSON.`, 500);
  }
}

function requireDocument(value: unknown, source: string): JsonRecord {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string"
    || typeof value.body !== "string" || typeof value.status !== "string") {
    throw new RuntimeDataError(`Invalid document in ${source}.`, 500);
  }
  return value;
}

export async function readRuntimeTickets(): Promise<FreshserviceTicket[]> {
  const parsed = await readRuntimeFile("freshservice_tickets.json");
  if (!isRecord(parsed) || !isRecord(parsed.tickets)) {
    throw new RuntimeDataError("Runtime Freshservice tickets must contain a tickets object.", 500);
  }
  return Object.entries(parsed.tickets).map(([id, entry]) => {
    if (!isRecord(entry) || !isRecord(entry.ticket) || entry.ticket.id !== id
      || typeof entry.ticket.subject !== "string" || !isRecord(entry.ticket.requester)
      || !isRecord(entry.ticket.incident) || !Array.isArray(entry.ticket.private_notes)
      || !Array.isArray(entry.ticket.conversation) || !Array.isArray(entry.ticket.tags)) {
      throw new RuntimeDataError(`Invalid Freshservice ticket ${id}.`, 500);
    }
    return entry.ticket as FreshserviceTicket;
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function readFreshserviceArticles(): Promise<FreshserviceArticle[]> {
  const parsed = await readRuntimeFile("freshservice_kb.json");
  if (!isRecord(parsed) || !Array.isArray(parsed.articles)) {
    throw new RuntimeDataError("Runtime Freshservice KB must contain an articles array.", 500);
  }
  return parsed.articles.map((value) => {
    const article = requireDocument(value, "freshservice_kb.json");
    if (!Array.isArray(article.tags) || !Array.isArray(article.platforms) || !Array.isArray(article.process_ids)) {
      throw new RuntimeDataError(`Invalid Freshservice article ${article.id}.`, 500);
    }
    return article as FreshserviceArticle;
  });
}

async function readConfluenceDocuments(): Promise<ConfluenceDocument[]> {
  const [dependencyMap, accessLayer, kb] = await Promise.all([
    readRuntimeFile("confluence_dependency_map.json"),
    readRuntimeFile("confluence_access_layer.json"),
    readRuntimeFile("confluence_kb.json"),
  ]);
  if (!isRecord(kb) || !Array.isArray(kb.pages)) {
    throw new RuntimeDataError("Runtime Confluence KB must contain a pages array.", 500);
  }
  const documents: Array<JsonRecord & { kind: string }> = [
    { ...requireDocument(dependencyMap, "confluence_dependency_map.json"), kind: "dependency_map" },
    { ...requireDocument(accessLayer, "confluence_access_layer.json"), kind: "access_layer" },
    ...kb.pages.map((page) => ({ ...requireDocument(page, "confluence_kb.json"), kind: "knowledge_base" })),
  ];
  return documents.map((page) => {
    if (page.status !== "published" && page.status !== "draft") {
      throw new RuntimeDataError(`Invalid Confluence status for ${page.id}.`, 500);
    }
    return page as ConfluenceDocument;
  });
}

export async function readRuntimeData(): Promise<RuntimeData> {
  const [tickets, freshservice_kb, confluence_documents] = await Promise.all([
    readRuntimeTickets(), readFreshserviceArticles(), readConfluenceDocuments(),
  ]);
  return { tickets, freshservice_kb, confluence_documents };
}
