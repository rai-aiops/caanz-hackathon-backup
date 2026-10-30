import { promises as fs } from "fs";
import path from "path";
import type { JsonRecord, SpanRecord, TraceEvent, TraceRecord, TraceSummary } from "./types";

type AppendTraceResult = {
  event: TraceEvent;
  record: TraceRecord;
};

const traceWriteLocks = new Map<string, Promise<void>>();

const dashboardRoot = process.cwd();
const repoRoot = path.basename(dashboardRoot) === "dashboard" ? path.dirname(dashboardRoot) : dashboardRoot;
const localTraceDir = path.join(dashboardRoot, ".local_traces");
const historicalTraceDir = path.join(repoRoot, "traces_logs");
const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 25;
const WINDOWS_RENAME_RETRY_MAX_DELAY_MS = 400;
// GPT-6/GPT-6.1 and GPT-5.6 rates verified 2026-10-28.
// https://developers.openai.com/api/docs/pricing
const MODEL_COSTS: Record<string, { input: number; cached_input?: number; cache_write?: number; output: number }> = {
  "openai/gpt-6-astra": { input: 10.0 / 1_000_000, cached_input: 1.0 / 1_000_000, cache_write: 12.5 / 1_000_000, output: 50.0 / 1_000_000 },
  "openai/gpt-6.1-sol": { input: 2.0 / 1_000_000, cached_input: 0.1 / 1_000_000, cache_write: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "openai/gpt-6.1-terra": { input: 1.0 / 1_000_000, cached_input: 0.05 / 1_000_000, cache_write: 1.25 / 1_000_000, output: 5.0 / 1_000_000 },
  "openai/gpt-6-sol": { input: 2.0 / 1_000_000, cached_input: 0.2 / 1_000_000, cache_write: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "openai/gpt-6-luna": { input: 0.1 / 1_000_000, cached_input: 0.01 / 1_000_000, cache_write: 0.125 / 1_000_000, output: 0.5 / 1_000_000 },
  "openai/gpt-5.6": { input: 4.0 / 1_000_000, cached_input: 0.4 / 1_000_000, cache_write: 5.0 / 1_000_000, output: 20.0 / 1_000_000 },
  "openai/gpt-5.6-sol": { input: 4.0 / 1_000_000, cached_input: 0.4 / 1_000_000, cache_write: 5.0 / 1_000_000, output: 20.0 / 1_000_000 },
  "openai/gpt-5.6-terra": { input: 2.0 / 1_000_000, cached_input: 0.2 / 1_000_000, cache_write: 2.5 / 1_000_000, output: 12.0 / 1_000_000 },
  "openai/gpt-5.6-luna": { input: 0.2 / 1_000_000, cached_input: 0.02 / 1_000_000, cache_write: 0.25 / 1_000_000, output: 1.2 / 1_000_000 },
  "openai/gpt-5.5": { input: 5.0 / 1_000_000, cached_input: 0.5 / 1_000_000, output: 30.0 / 1_000_000 },
  "openai/gpt-5.5-pro": { input: 30.0 / 1_000_000, output: 180.0 / 1_000_000 },
  "openai/gpt-5.4": { input: 2.5 / 1_000_000, cached_input: 0.25 / 1_000_000, output: 15.0 / 1_000_000 },
  "openai/gpt-5.4-mini": { input: 0.75 / 1_000_000, cached_input: 0.075 / 1_000_000, output: 4.5 / 1_000_000 },
  "openai/gpt-5.4-nano": { input: 0.2 / 1_000_000, cached_input: 0.02 / 1_000_000, output: 1.25 / 1_000_000 },
  "openai/gpt-5.4-pro": { input: 30.0 / 1_000_000, output: 180.0 / 1_000_000 },
};

const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
const SERVICE_TIER_MULTIPLIERS: Record<string, number> = {
  flex: 0.5,
  fast: 2,
  priority: 2,
  ultrafast: 6,
};
const LONG_CONTEXT_PRICED_MODELS = new Set([
  "openai/gpt-6-astra",
  "openai/gpt-6.1-sol",
  "openai/gpt-6.1-terra",
  "openai/gpt-6-sol",
  "openai/gpt-6-luna",
  "openai/gpt-5.6",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "openai/gpt-5.4",
  "openai/gpt-5.4-pro",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

async function renameTraceFile(tempPath: string, filePath: string) {
  for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const code = getErrorCode(error);
      const isRetryableWindowsError = process.platform === "win32"
        && (code === "EPERM" || code === "EBUSY");
      if (!isRetryableWindowsError) throw error;

      if (attempt === WINDOWS_RENAME_RETRY_ATTEMPTS - 1) {
        // Windows can hold the destination open long enough to exhaust atomic
        // rename retries. The temp file is complete, so overwrite from it as a
        // final fallback instead of dropping the telemetry event.
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath).catch(() => undefined);
        return;
      }

      const delayMs = Math.min(
        WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt,
        WINDOWS_RENAME_RETRY_MAX_DELAY_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function withTraceWriteLock<T>(traceId: string, work: () => Promise<T>) {
  const previous = traceWriteLocks.get(traceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = previous.catch(() => undefined).then(() => current);

  traceWriteLocks.set(traceId, active);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    release();
    if (traceWriteLocks.get(traceId) === active) traceWriteLocks.delete(traceId);
  }
}

function safeTraceFilename(traceId: string) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(traceId)) return null;
  return `${traceId}.json`;
}

function localTracePath(traceId: string) {
  const filename = safeTraceFilename(traceId);
  return filename ? path.join(localTraceDir, filename) : null;
}

function historicalTracePath(traceId: string) {
  const filename = safeTraceFilename(traceId);
  return filename ? path.join(historicalTraceDir, filename) : null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const contents = await fs.readFile(filePath, "utf-8");
    try {
      return JSON.parse(contents) as T;
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;

      const position = /position (\d+)/.exec(parseError.message)?.[1];
      if (position) {
        try {
          return JSON.parse(contents.slice(0, Number(position)).trimEnd()) as T;
        } catch {
          return null;
        }
      }

      return null;
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function listJsonFiles(directory: string) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return [];
    throw error;
  }
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function getWorkflowName(raw: JsonRecord) {
  if (typeof raw.workflow_name === "string" && raw.workflow_name.trim()) return raw.workflow_name;
  if (isRecord(raw.trace) && typeof raw.trace.workflow_name === "string" && raw.trace.workflow_name.trim()) {
    return raw.trace.workflow_name;
  }
  return undefined;
}

function getTraceIdFromPayload(payload: TraceEvent) {
  if (typeof payload.trace_id === "string" && payload.trace_id) return payload.trace_id;
  if (isRecord(payload.trace) && typeof payload.trace.id === "string") return payload.trace.id;
  if (isRecord(payload.span) && typeof payload.span.trace_id === "string") return payload.span.trace_id;
  return `local_${Date.now()}`;
}

function getSpanId(span: SpanRecord) {
  if (typeof span.id === "string") return span.id;
  if (typeof span.span_id === "string") return span.span_id;
  return undefined;
}

function getSpanData(span: SpanRecord) {
  return isRecord(span.span_data) ? span.span_data : {};
}

function getSpanStart(span: SpanRecord) {
  return normalizeDate(span.started_at ?? span.start_time);
}

function getSpanEnd(span: SpanRecord) {
  return normalizeDate(span.ended_at ?? span.end_time);
}

function hasSpanEnd(span: SpanRecord) {
  return Boolean(getSpanEnd(span));
}

function mergeSpanSnapshot(existing: SpanRecord | undefined, incoming: SpanRecord, eventType: string) {
  if (!existing) return incoming;
  if (eventType === "span_start" && hasSpanEnd(existing)) return existing;
  if (eventType === "span_start") return { ...incoming, ...existing };
  return { ...existing, ...incoming };
}

function getUsageFromSpan(span: SpanRecord) {
  const data = getSpanData(span);
  const response = isRecord(span.response) ? span.response : null;
  const usage = isRecord(response?.usage) ? response.usage : isRecord(data.usage) ? data.usage : null;
  const inputDetails = isRecord(usage?.input_tokens_details) ? usage.input_tokens_details : null;
  const outputDetails = isRecord(usage?.output_tokens_details) ? usage.output_tokens_details : null;

  return {
    input: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    cached: typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens : 0,
    cacheWrite: typeof inputDetails?.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0,
    output: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
    reasoning: typeof outputDetails?.reasoning_tokens === "number" ? outputDetails.reasoning_tokens : 0,
    total: typeof usage?.total_tokens === "number" ? usage.total_tokens : 0,
    model: typeof response?.model === "string" ? response.model : typeof data.model === "string" ? data.model : undefined,
    serviceTier: typeof response?.service_tier === "string" ? response.service_tier : undefined,
  };
}

function getModelCost(model?: string, serviceTier?: string) {
  if (!model) return undefined;
  const normalized = normalizeModelForCost(model);
  const modelKey = MODEL_COSTS[normalized]
    ? normalized
    : Object.keys(MODEL_COSTS)
      .sort((left, right) => right.length - left.length)
      .find((prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`));
  if (!modelKey) return undefined;
  if (serviceTier?.toLowerCase() === "ultrafast"
    && modelKey !== "openai/gpt-6-astra" && modelKey !== "openai/gpt-6.1-sol") return undefined;
  const baseCost = MODEL_COSTS[modelKey];
  const supportsServiceTier = modelKey.startsWith("openai/gpt-6-")
    || modelKey.startsWith("openai/gpt-6.")
    || modelKey.startsWith("openai/gpt-5.6");
  const tierMultiplier = supportsServiceTier
    ? SERVICE_TIER_MULTIPLIERS[serviceTier?.toLowerCase() ?? ""] ?? 1
    : 1;
  return {
    input: baseCost.input * tierMultiplier,
    cached_input: (baseCost.cached_input ?? baseCost.input) * tierMultiplier,
    cache_write: (baseCost.cache_write ?? baseCost.input) * tierMultiplier,
    output: baseCost.output * tierMultiplier,
  };
}

function normalizeModelForCost(model: string) {
  const normalized = model.toLowerCase().replace(/^litellm_proxy\//, "");
  if (normalized.startsWith("openai/")) return normalized;
  return `openai/${normalized}`;
}

function estimateSpanCost(span: SpanRecord) {
  const usage = getUsageFromSpan(span);
  const cost = getModelCost(usage.model, usage.serviceTier);
  if (!cost) return 0;
  const input = Math.max(usage.input, 0);
  const cached = Math.min(Math.max(usage.cached, 0), input);
  const cacheWrite = Math.min(Math.max(usage.cacheWrite, 0), input - cached);
  const uncached = input - cached - cacheWrite;
  const normalizedModel = usage.model ? normalizeModelForCost(usage.model) : "";
  const hasLongContextPricing = usage.input > LONG_CONTEXT_INPUT_TOKEN_THRESHOLD
    && [...LONG_CONTEXT_PRICED_MODELS].some(
      (model) => normalizedModel === model || normalizedModel.startsWith(`${model}-`),
    );
  const inputMultiplier = hasLongContextPricing ? 2 : 1;
  const outputMultiplier = hasLongContextPricing ? 1.5 : 1;
  return (
    uncached * cost.input * inputMultiplier
    + cached * (cost.cached_input ?? cost.input) * inputMultiplier
    + cacheWrite * (cost.cache_write ?? cost.input) * inputMultiplier
    + usage.output * cost.output * outputMultiplier
  );
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getLatestCostSummary(events: TraceEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "cost_summary") continue;

    const totalCost = getNumber(event.total_cost);
    if (totalCost === undefined) continue;

    return {
      total_cost: totalCost,
      total_tokens: getNumber(event.total_tokens),
      model_cost: getNumber(event.model_cost),
      tool_cost: getNumber(event.tool_cost),
    };
  }

  return null;
}

function traceRecordFromRaw(raw: unknown, fallbackTraceId?: string): TraceRecord | null {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.events) && Array.isArray(raw.spans) && typeof raw.trace_id === "string") {
    return {
      trace_id: raw.trace_id,
      workflow_name: getWorkflowName(raw),
      status: raw.status === "running" ? "running" : "completed",
      started_at: normalizeDate(raw.started_at),
      ended_at: normalizeDate(raw.ended_at),
      updated_at: normalizeDate(raw.updated_at),
      trace: isRecord(raw.trace) ? raw.trace : undefined,
      run_snapshot: isRecord(raw.run_snapshot) ? raw.run_snapshot : undefined,
      events: raw.events.filter(isRecord).map((event) => event as TraceEvent),
      spans: raw.spans.filter(isRecord).map((span) => span as SpanRecord),
    };
  }

  const traceId = typeof raw.id === "string" ? raw.id : fallbackTraceId;
  if (!traceId) return null;

  const spans = Array.isArray(raw.spans) ? raw.spans.filter(isRecord).map((span) => span as SpanRecord) : [];
  const startTimes = spans.map(getSpanStart).filter((value): value is string => Boolean(value));
  const endTimes = spans.map(getSpanEnd).filter((value): value is string => Boolean(value));

  return {
    trace_id: traceId,
    workflow_name: getWorkflowName(raw),
    status: raw.status === "running" ? "running" : "completed",
    started_at: startTimes.sort()[0],
    ended_at: endTimes.sort().at(-1),
    updated_at: endTimes.sort().at(-1),
    trace: { ...raw, spans: undefined },
    run_snapshot: isRecord(raw.run_snapshot) ? raw.run_snapshot : undefined,
    events: [],
    spans,
  };
}

function reconcileTraceRecords(
  historicalRecord: TraceRecord | null,
  localRecord: TraceRecord | null,
): TraceRecord | null {
  if (!localRecord) return historicalRecord;
  if (!historicalRecord || historicalRecord.status !== "completed" || localRecord.status === "completed") {
    return localRecord;
  }

  return {
    ...localRecord,
    status: "completed",
    ended_at: historicalRecord.ended_at ?? localRecord.ended_at,
    updated_at: historicalRecord.updated_at ?? localRecord.updated_at,
    run_snapshot: localRecord.run_snapshot ?? historicalRecord.run_snapshot,
  };
}

function buildSummary(record: TraceRecord): TraceSummary {
  const events = record.events.filter((event) => !["heartbeat", "connected", "span_start"].includes(event.type));
  const spans = record.spans;
  const errorCount = spans.filter((span) => Boolean(span.error)).length;
  const agentNames = new Set<string>();
  const toolNames = new Set<string>();
  const guardrailNames = new Set<string>();

  for (const event of events) {
    if (typeof event.agent_name === "string") agentNames.add(event.agent_name);
    if (typeof event.tool_name === "string") toolNames.add(event.tool_name);
    if (typeof event.guardrail_name === "string") guardrailNames.add(event.guardrail_name);
  }

  for (const span of spans) {
    const data = getSpanData(span);
    const type = typeof data.type === "string" ? data.type : typeof span.type === "string" ? span.type : "";
    const name = typeof data.name === "string" ? data.name : typeof span.name === "string" ? span.name : undefined;
    if (type.includes("agent") && name) agentNames.add(name);
    if ((type.includes("function") || type.includes("tool")) && name) toolNames.add(name);
    if (type.includes("guardrail") && name) guardrailNames.add(name);

    const response = isRecord(span.response) ? span.response : null;
    const output = Array.isArray(response?.output) ? response.output : [];
    for (const item of output) {
      if (isRecord(item) && item.type === "function_call" && typeof item.name === "string") toolNames.add(item.name);
    }
  }

  const start = record.started_at ?? spans.map(getSpanStart).filter((value): value is string => Boolean(value)).sort()[0];
  const end = record.ended_at ?? spans.map(getSpanEnd).filter((value): value is string => Boolean(value)).sort().at(-1);
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  const durationMs = Number.isNaN(startMs) || Number.isNaN(endMs) ? undefined : Math.max(endMs - startMs, 0);

  const spanVisibleTokens = spans.reduce((total, span) => total + getUsageFromSpan(span).total, 0);
  const spanVisibleCost = spans.reduce((total, span) => total + estimateSpanCost(span), 0);
  const costSummary = getLatestCostSummary(events);
  const totalTokens = costSummary?.total_tokens ?? spanVisibleTokens;
  const totalCost = costSummary?.total_cost ?? spanVisibleCost;

  return {
    trace_id: record.trace_id,
    workflow_name: record.workflow_name,
    status: record.status,
    started_at: start,
    ended_at: end,
    updated_at: record.updated_at ?? end ?? start,
    duration_ms: durationMs,
    event_count: events.length,
    span_count: spans.length,
    agent_count: agentNames.size,
    tool_count: toolNames.size,
    guardrail_count: guardrailNames.size,
    error_count: errorCount,
    total_tokens: totalTokens,
    total_cost: totalCost,
    cost_source: costSummary ? "cost_summary" : "span_estimate",
    span_visible_tokens: spanVisibleTokens,
    span_visible_cost: spanVisibleCost,
    model_cost: costSummary?.model_cost,
    tool_cost: costSummary?.tool_cost,
    unattributed_cost: costSummary ? totalCost - spanVisibleCost : 0,
  };
}

async function writeRecord(record: TraceRecord) {
  const filePath = localTracePath(record.trace_id);
  if (!filePath) throw new Error("Invalid trace_id.");
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.mkdir(localTraceDir, { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    await renameTraceFile(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function saveTraceRunSnapshot(
  traceId: string,
  runSnapshot: JsonRecord,
): Promise<TraceRecord | null> {
  return withTraceWriteLock(traceId, async () => {
    const record = await readTrace(traceId);
    if (!record) return null;
    const updatedRecord = { ...record, run_snapshot: runSnapshot };
    await writeRecord(updatedRecord);
    return updatedRecord;
  });
}

export async function appendTraceEvent(payload: TraceEvent): Promise<AppendTraceResult> {
  const traceId = getTraceIdFromPayload(payload);
  const timestamp = normalizeDate(payload.timestamp) ?? new Date().toISOString();
  const event: TraceEvent = { ...payload, trace_id: traceId, timestamp };

  return withTraceWriteLock(traceId, async () => {
    const existing = await readTrace(traceId);
    const record: TraceRecord = existing ?? {
      trace_id: traceId,
      status: "running",
      started_at: timestamp,
      updated_at: timestamp,
      events: [],
      spans: [],
    };

    record.events = [...record.events, event];
    record.updated_at = timestamp;
    record.started_at = record.started_at ?? timestamp;

    if (isRecord(event.trace)) record.trace = event.trace;
    if (isRecord(event.trace) && typeof event.trace.workflow_name === "string" && event.trace.workflow_name.trim()) {
      record.workflow_name = event.trace.workflow_name;
    }
    if (event.type === "trace_end") {
      record.status = "completed";
      record.ended_at = timestamp;
    }
    if (event.type === "trace_start") record.status = "running";

    if (isRecord(event.span)) {
      const span = event.span as SpanRecord;
      const spanId = getSpanId(span);
      const existingIndex = spanId ? record.spans.findIndex((item) => getSpanId(item) === spanId) : -1;
      if (existingIndex >= 0) {
        record.spans[existingIndex] = mergeSpanSnapshot(record.spans[existingIndex], span, event.type);
      } else {
        record.spans = [...record.spans, span];
      }
    }

    await writeRecord(record);
    return { event, record };
  });
}

export async function readTrace(traceId: string): Promise<TraceRecord | null> {
  const localPath = localTracePath(traceId);
  if (!localPath) return null;

  const historicalPath = historicalTracePath(traceId);
  if (!historicalPath) return null;
  const [localRaw, historicalRaw] = await Promise.all([
    readJsonFile(localPath),
    readJsonFile(historicalPath),
  ]);
  return reconcileTraceRecords(
    traceRecordFromRaw(historicalRaw, traceId),
    traceRecordFromRaw(localRaw, traceId),
  );
}

export async function listTraceSummaries(): Promise<TraceSummary[]> {
  const records = new Map<string, TraceRecord>();

  for (const filePath of await listJsonFiles(historicalTraceDir)) {
    const traceId = path.basename(filePath, ".json");
    const record = traceRecordFromRaw(await readJsonFile(filePath), traceId);
    if (record) records.set(record.trace_id, record);
  }

  for (const filePath of await listJsonFiles(localTraceDir)) {
    const traceId = path.basename(filePath, ".json");
    const record = traceRecordFromRaw(await readJsonFile(filePath), traceId);
    if (record) {
      records.set(
        record.trace_id,
        reconcileTraceRecords(records.get(record.trace_id) ?? null, record) ?? record,
      );
    }
  }

  return Array.from(records.values())
    .map(buildSummary)
    .sort((left, right) => Date.parse(right.updated_at ?? right.started_at ?? "") - Date.parse(left.updated_at ?? left.started_at ?? ""));
}

export async function deleteTrace(traceId: string) {
  const paths = [localTracePath(traceId), historicalTracePath(traceId)].filter((value): value is string => Boolean(value));
  let deleted = false;

  for (const filePath of paths) {
    try {
      await fs.unlink(filePath);
      deleted = true;
    } catch (error) {
      if (getErrorCode(error) !== "ENOENT") throw error;
    }
  }

  return { trace_id: traceId, deleted };
}
