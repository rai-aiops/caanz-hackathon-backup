import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { readEvalContextMarkdown } from "./evalContextStore";
import {
  postJudgeResponses,
  type JudgeApiKeySource,
  type JudgeProvider,
  type JudgeRequestMetadata,
} from "./judgeClient";
import { readSavedJudgePrompt } from "./judgePromptStore";
import type { JsonRecord, SpanRecord, TraceEvent, TraceRecord } from "./types";

type EvalJudgeResult = {
  trace_id: string;
  verdict: "pass" | "fail";
  score: number;
  hallucination_score: number;
  hallucination_reasoning: string;
  trace_summary: string;
  reasoning: string;
  strengths: string[];
  issues: string[];
  judge_provider: JudgeProvider;
  judge_model_requested: string;
  judge_model_used: string;
  judge_fallback_used: boolean;
  judge_api_key_source?: JudgeApiKeySource;
  input_tokens: number;
  uncached_input_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  input_cost: number | null;
  uncached_input_cost: number | null;
  cached_input_cost: number | null;
  cache_write_cost: number | null;
  output_cost: number | null;
  reasoning_cost: number | null;
  total_cost: number | null;
  judge_usage: Record<string, unknown>;
  judge_service_tier?: string;
};

export type PromptImprovementChange = {
  target_file: string;
  target_agent: string;
  prompt_name: string;
  original_prompt: string;
  proposed_prompt: string;
  reasoning: string;
};

export type PromptImprovementResult = {
  prompt_changes: PromptImprovementChange[];
  judge_provider: JudgeProvider;
  judge_model_requested: string;
  judge_model_used: string;
  judge_fallback_used: boolean;
  judge_api_key_source?: JudgeApiKeySource;
  input_tokens: number;
  uncached_input_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  input_cost: number | null;
  uncached_input_cost: number | null;
  cached_input_cost: number | null;
  cache_write_cost: number | null;
  output_cost: number | null;
  reasoning_cost: number | null;
  total_cost: number | null;
  judge_usage: Record<string, unknown>;
  judge_service_tier?: string;
};

type JudgeUsageMetrics = {
  input_tokens: number;
  uncached_input_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  input_cost: number | null;
  uncached_input_cost: number | null;
  cached_input_cost: number | null;
  cache_write_cost: number | null;
  output_cost: number | null;
  reasoning_cost: number | null;
  total_cost: number | null;
  judge_usage: Record<string, unknown>;
  judge_service_tier?: string;
};

export type EvalJudgeError = Error & Partial<JudgeRequestMetadata & JudgeUsageMetrics>;

const dashboardRoot = process.cwd();
const repoRoot = path.basename(dashboardRoot) === "dashboard" ? path.dirname(dashboardRoot) : dashboardRoot;
const TRACE_JUDGE_SOURCE_PATHS = ["main.py", "tools", "guardrails"];
const PROMPT_OPTIMIZATION_SOURCE_PATHS = ["main.py", "custom_agents", "tools", "guardrails"];
const TRACE_EVAL_MAX_OUTPUT_TOKENS = 3000;
const TRACE_EVAL_SUMMARY_MAX_CHARS = 600;
const TRACE_EVAL_REASONING_MAX_CHARS = 900;
const TRACE_EVAL_LIST_MAX_ITEMS = 5;
const TRACE_EVAL_LIST_ITEM_MAX_CHARS = 240;
const TRACE_EVAL_CACHE_KEY_VERSION = "v1";
const TRACE_EVAL_FRAMING = "Evaluate this trace and return the requested JSON only.";
const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
const STABLE_RESPONSE_CONFIG_FIELDS = [
  "background",
  "billing",
  "frequency_penalty",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "model",
  "moderation",
  "parallel_tool_calls",
  "presence_penalty",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_retention",
  "reasoning",
  "safety_identifier",
  "service_tier",
  "store",
  "temperature",
  "tool_choice",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;
const EVAL_USAGE_FIELD_NAMES = new Set([
  "usage",
  "tool_usage",
  "token_usage",
  "input_tokens",
  "uncached_input_tokens",
  "output_tokens",
  "total_tokens",
  "cached_tokens",
  "cached_input_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "input_tokens_details",
  "output_tokens_details",
  "input_cost",
  "uncached_input_cost",
  "cached_input_cost",
  "cache_write_cost",
  "output_cost",
  "reasoning_cost",
  "model_cost",
  "tool_cost",
  "total_cost",
  "agent_costs",
  "tool_costs",
  "total_agent_cost",
  "total_tool_cost",
]);
const EVAL_USAGE_EVENT_TYPES = new Set(["cost_summary", "usage_summary"]);
type PricingTier = "default" | "flex" | "priority" | "ultrafast";
type TokenPrices = {
  input: number;
  cached_input: number;
  cache_write: number;
  output: number;
};

// GPT-6/GPT-6.1 and GPT-5.6 rates verified 2026-10-28.
// https://developers.openai.com/api/docs/pricing
const TOKEN_PRICES_PER_MILLION: Record<
  string,
  Partial<Record<PricingTier, TokenPrices>>
> = {
  "gpt-6-astra": {
    default: { input: 10, cached_input: 1, cache_write: 12.5, output: 50 },
    flex: { input: 5, cached_input: 0.5, cache_write: 6.25, output: 25 },
    priority: { input: 20, cached_input: 2, cache_write: 25, output: 100 },
    ultrafast: { input: 60, cached_input: 6, cache_write: 75, output: 300 },
  },
  "gpt-6.1-sol": {
    default: { input: 2, cached_input: 0.1, cache_write: 2.5, output: 10 },
    flex: { input: 1, cached_input: 0.05, cache_write: 1.25, output: 5 },
    priority: { input: 4, cached_input: 0.2, cache_write: 5, output: 20 },
    ultrafast: { input: 12, cached_input: 0.6, cache_write: 15, output: 60 },
  },
  "gpt-6-sol": {
    default: { input: 2, cached_input: 0.2, cache_write: 2.5, output: 10 },
    flex: { input: 1, cached_input: 0.1, cache_write: 1.25, output: 5 },
    priority: { input: 4, cached_input: 0.4, cache_write: 5, output: 20 },
  },
  "gpt-6.1-terra": {
    default: { input: 1, cached_input: 0.05, cache_write: 1.25, output: 5 },
    flex: { input: 0.5, cached_input: 0.025, cache_write: 0.625, output: 2.5 },
    priority: { input: 2, cached_input: 0.1, cache_write: 2.5, output: 10 },
  },
  "gpt-6-luna": {
    default: { input: 0.1, cached_input: 0.01, cache_write: 0.125, output: 0.5 },
    flex: { input: 0.05, cached_input: 0.005, cache_write: 0.0625, output: 0.25 },
    priority: { input: 0.2, cached_input: 0.02, cache_write: 0.25, output: 1 },
  },
  "gpt-5.6-sol": {
    default: { input: 4, cached_input: 0.4, cache_write: 5, output: 20 },
    flex: { input: 2, cached_input: 0.2, cache_write: 2.5, output: 10 },
    priority: { input: 8, cached_input: 0.8, cache_write: 10, output: 40 },
  },
  "gpt-5.6-terra": {
    default: { input: 2, cached_input: 0.2, cache_write: 2.5, output: 12 },
    flex: { input: 1, cached_input: 0.1, cache_write: 1.25, output: 6 },
    priority: { input: 4, cached_input: 0.4, cache_write: 5, output: 24 },
  },
  "gpt-5.6-luna": {
    default: { input: 0.2, cached_input: 0.02, cache_write: 0.25, output: 1.2 },
    flex: { input: 0.1, cached_input: 0.01, cache_write: 0.125, output: 0.6 },
    priority: { input: 0.4, cached_input: 0.04, cache_write: 0.5, output: 2.4 },
  },
  "gpt-5.6": {
    default: { input: 4, cached_input: 0.4, cache_write: 5, output: 20 },
    flex: { input: 2, cached_input: 0.2, cache_write: 2.5, output: 10 },
    priority: { input: 8, cached_input: 0.8, cache_write: 10, output: 40 },
  },
  "gpt-5.5": {
    default: { input: 5, cached_input: 0.5, cache_write: 5, output: 30 },
  },
  "gpt-5.5-pro": {
    default: { input: 30, cached_input: 30, cache_write: 30, output: 180 },
  },
  "gpt-5.4": {
    default: { input: 2.5, cached_input: 0.25, cache_write: 2.5, output: 15 },
  },
  "gpt-5.4-pro": {
    default: { input: 30, cached_input: 30, cache_write: 30, output: 180 },
  },
  "gpt-5.4-mini": {
    default: { input: 0.75, cached_input: 0.075, cache_write: 0.75, output: 4.5 },
  },
  "gpt-5.4-nano": {
    default: { input: 0.2, cached_input: 0.02, cache_write: 0.2, output: 1.25 },
  },
};

const LONG_CONTEXT_PRICED_JUDGE_MODELS = new Set([
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
]);

type EvalTraceCompactionStats = {
  original_event_count: number;
  original_span_count: number;
  omitted_event_span_snapshots: number;
  duplicate_span_data_fields_omitted: number;
  duplicate_response_instructions_omitted: number;
  duplicate_response_tools_omitted: number;
  duplicate_response_text_omitted: number;
  duplicate_response_config_fields_omitted: number;
  duplicate_response_config_fields_omitted_by_name: Record<string, number>;
  encrypted_reasoning_fields_omitted: number;
  usage_fields_omitted: number;
  usage_events_omitted: number;
};

type EvalTraceRecord = Omit<TraceRecord, "events" | "spans"> & {
  events: JsonRecord[];
  spans: JsonRecord[];
  eval_compaction: EvalTraceCompactionStats;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonRecord(value: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function filterEvalOnlyData(value: unknown, stats: EvalTraceCompactionStats): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => filterEvalOnlyData(item, stats));
  }
  if (!isRecord(value)) return value;

  const filtered: JsonRecord = {};
  const isReasoningItem = value.type === "reasoning";
  const isUsageContainer = Object.keys(value).some((key) => EVAL_USAGE_FIELD_NAMES.has(key));

  for (const [key, childValue] of Object.entries(value)) {
    if (EVAL_USAGE_FIELD_NAMES.has(key)) {
      stats.usage_fields_omitted += 1;
      continue;
    }
    if (isUsageContainer && (key === "requests" || key === "num_requests")) {
      stats.usage_fields_omitted += 1;
      continue;
    }
    if (isReasoningItem && key === "encrypted_content") {
      stats.encrypted_reasoning_fields_omitted += 1;
      continue;
    }
    filtered[key] = filterEvalOnlyData(childValue, stats);
  }

  return filtered;
}

function supportsExplicitPromptCaching(judgeModel: string) {
  const normalized = judgeModel.toLowerCase().replace(/^openai\//, "");
  return normalized === "gpt-6"
    || normalized.startsWith("gpt-6-")
    || normalized.startsWith("gpt-6.")
    || normalized === "gpt-5.6"
    || normalized.startsWith("gpt-5.6-");
}

function getTraceEvalPromptCacheKey(judgeContext: string) {
  const stableContextHash = createHash("sha256")
    .update(`${TRACE_EVAL_CACHE_KEY_VERSION}\n${judgeContext}`)
    .digest("hex")
    .slice(0, 24);
  return `dashboard-trace-eval:${stableContextHash}`;
}

function getTraceEvalInput(
  evalTrace: EvalTraceRecord,
  judgeContext: string,
  judgeModel: string,
) {
  const traceContent = JSON.stringify(evalTrace, null, 2);
  if (!supportsExplicitPromptCaching(judgeModel)) {
    return {
      input: `${TRACE_EVAL_FRAMING}\n\n${traceContent}`,
    };
  }

  return {
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: TRACE_EVAL_FRAMING,
            prompt_cache_breakpoint: {
              mode: "explicit",
            },
          },
          {
            type: "input_text",
            text: traceContent,
          },
        ],
      },
    ],
    prompt_cache_key: getTraceEvalPromptCacheKey(judgeContext),
    prompt_cache_options: {
      mode: "explicit",
    },
  };
}

function valuesMatch(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function getSpanId(span: JsonRecord) {
  if (typeof span.id === "string") return span.id;
  if (typeof span.span_id === "string") return span.span_id;
  return undefined;
}

function getSpanData(span: JsonRecord) {
  return isRecord(span.span_data) ? span.span_data : {};
}

function getSpanTitle(span: JsonRecord) {
  const data = getSpanData(span);
  const name = data.name ?? data.tool_name ?? data.agent_name ?? data.type ?? span.name ?? span.type;
  return typeof name === "string" && name ? name : undefined;
}

function compactSpanReference(span: SpanRecord) {
  const spanRecord = span as JsonRecord;
  const data = getSpanData(spanRecord);
  const reference: JsonRecord = {};
  const spanId = getSpanId(spanRecord);
  const title = getSpanTitle(spanRecord);
  const parentId = spanRecord.parent_id;
  const type = data.type ?? spanRecord.type;

  if (spanId) reference.span_id = spanId;
  if (title) reference.name = title;
  if (typeof type === "string" && type) reference.type = type;
  if (typeof parentId === "string") reference.parent_id = parentId;

  return reference;
}

function compactEvalEvent(event: TraceEvent, stats: EvalTraceCompactionStats): JsonRecord {
  const compactEvent: JsonRecord = {};

  for (const [key, value] of Object.entries(event)) {
    if (key === "span") {
      if (isRecord(value)) {
        compactEvent.span_ref = compactSpanReference(value as SpanRecord);
        stats.omitted_event_span_snapshots += 1;
      }
      continue;
    }

    compactEvent[key] = value;
  }

  return filterEvalOnlyData(compactEvent, stats) as JsonRecord;
}

function deduplicateResponseField(
  response: JsonRecord,
  fieldName: string,
  references: Map<string, string>,
  spanId: string | undefined,
  onDuplicate: () => void,
  requireSmallerReference = false,
) {
  const value = response[fieldName];
  if (value === undefined || value === null) return;

  const serialized = stableJson(value);
  if (typeof serialized !== "string") return;

  const existingReference = references.get(serialized);
  if (!existingReference) {
    references.set(
      serialized,
      spanId ? `${spanId}.response.${fieldName}` : `earlier_span.response.${fieldName}`,
    );
    return;
  }

  const reference = { $ref: existingReference };
  if (requireSmallerReference && stableJson(reference).length >= serialized.length) return;

  response[fieldName] = reference;
  onDuplicate();
}

function compactEvalSpan(
  span: SpanRecord,
  instructionReferences: Map<string, string>,
  toolReferences: Map<string, string>,
  textReferences: Map<string, string>,
  configReferences: Map<string, Map<string, string>>,
  stats: EvalTraceCompactionStats,
): JsonRecord {
  const compactSpan = cloneJsonRecord(span as JsonRecord);
  const spanId = getSpanId(compactSpan);

  if (isRecord(compactSpan.span_data)) {
    const spanData = { ...compactSpan.span_data };

    if ("input" in compactSpan && "input" in spanData && valuesMatch(compactSpan.input, spanData.input)) {
      delete spanData.input;
      stats.duplicate_span_data_fields_omitted += 1;
    }

    if ("output" in compactSpan && "output" in spanData && valuesMatch(compactSpan.output, spanData.output)) {
      delete spanData.output;
      stats.duplicate_span_data_fields_omitted += 1;
    }

    compactSpan.span_data = spanData;
  }

  if (isRecord(compactSpan.response) && typeof compactSpan.response.instructions === "string") {
    const response = { ...compactSpan.response };
    const instructions = String(response.instructions);
    const existingReference = instructionReferences.get(instructions);

    if (existingReference) {
      response.instructions = `[duplicate response.instructions omitted; matches ${existingReference}]`;
      stats.duplicate_response_instructions_omitted += 1;
    } else {
      instructionReferences.set(instructions, spanId ? `span ${spanId}` : "an earlier span");
    }

    compactSpan.response = response;
  }

  if (isRecord(compactSpan.response)) {
    const response = { ...compactSpan.response };
    const responseFields = [
      {
        name: "tools",
        references: toolReferences,
        increment: () => {
          stats.duplicate_response_tools_omitted += 1;
        },
      },
      {
        name: "text",
        references: textReferences,
        increment: () => {
          stats.duplicate_response_text_omitted += 1;
        },
      },
    ] as const;

    for (const field of responseFields) {
      deduplicateResponseField(
        response,
        field.name,
        field.references,
        spanId,
        field.increment,
      );
    }

    for (const fieldName of STABLE_RESPONSE_CONFIG_FIELDS) {
      let references = configReferences.get(fieldName);
      if (!references) {
        references = new Map<string, string>();
        configReferences.set(fieldName, references);
      }

      deduplicateResponseField(
        response,
        fieldName,
        references,
        spanId,
        () => {
          stats.duplicate_response_config_fields_omitted += 1;
          stats.duplicate_response_config_fields_omitted_by_name[fieldName] =
            (stats.duplicate_response_config_fields_omitted_by_name[fieldName] ?? 0) + 1;
        },
        true,
      );
    }

    compactSpan.response = response;
  }

  return filterEvalOnlyData(compactSpan, stats) as JsonRecord;
}

function buildTraceForEval(trace: TraceRecord): EvalTraceRecord {
  const stats: EvalTraceCompactionStats = {
    original_event_count: trace.events.length,
    original_span_count: trace.spans.length,
    omitted_event_span_snapshots: 0,
    duplicate_span_data_fields_omitted: 0,
    duplicate_response_instructions_omitted: 0,
    duplicate_response_tools_omitted: 0,
    duplicate_response_text_omitted: 0,
    duplicate_response_config_fields_omitted: 0,
    duplicate_response_config_fields_omitted_by_name: {},
    encrypted_reasoning_fields_omitted: 0,
    usage_fields_omitted: 0,
    usage_events_omitted: 0,
  };
  const instructionReferences = new Map<string, string>();
  const toolReferences = new Map<string, string>();
  const textReferences = new Map<string, string>();
  const configReferences = new Map<string, Map<string, string>>();

  return {
    trace_id: trace.trace_id,
    workflow_name: trace.workflow_name,
    status: trace.status,
    started_at: trace.started_at,
    ended_at: trace.ended_at,
    updated_at: trace.updated_at,
    trace: filterEvalOnlyData(trace.trace, stats) as JsonRecord | undefined,
    events: trace.events.flatMap((event) => {
      if (EVAL_USAGE_EVENT_TYPES.has(event.type)) {
        stats.usage_events_omitted += 1;
        return [];
      }
      return [compactEvalEvent(event, stats)];
    }),
    spans: trace.spans.map((span) => compactEvalSpan(
      span,
      instructionReferences,
      toolReferences,
      textReferences,
      configReferences,
      stats,
    )),
    eval_compaction: stats,
  };
}

async function readPythonSources(targetPath: string): Promise<Array<{ name: string; source: string }>> {
  const absolutePath = path.join(repoRoot, targetPath);
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isFile() && absolutePath.endsWith(".py")) {
      return [{ name: targetPath, source: await fs.readFile(absolutePath, "utf-8") }];
    }
    if (!stat.isDirectory()) return [];
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => readPythonSources(path.join(targetPath, entry.name))),
  );
  return nested.flat().sort((left, right) => left.name.localeCompare(right.name));
}

export async function buildDynamicJudgeContext(judgePrompt?: string) {
  const sources = (await Promise.all(TRACE_JUDGE_SOURCE_PATHS.map(readPythonSources))).flat();
  const sourceContext = sources
    .map(({ name, source }) => `### ${name}\n\`\`\`python\n${source}\n\`\`\``)
    .join("\n\n");
  const addedContext = await readEvalContextMarkdown();
  const prompt = judgePrompt?.trim() || await readSavedJudgePrompt();
  const contextSection = addedContext
    ? `\n\n## Dashboard-Added Evaluation Context\nUse this context as requirements and supporting evidence when evaluating the trace. If the context conflicts with source behavior, call that out explicitly.\n\n${addedContext}`
    : "";

  return `${prompt}${contextSection}\n\n## Current Source Context\n${sourceContext || "No Python source context found."}`;
}

async function buildSourceContext() {
  const sources = (await Promise.all(PROMPT_OPTIMIZATION_SOURCE_PATHS.map(readPythonSources))).flat();
  return sources
    .map(({ name, source }) => `### ${name}\n\`\`\`python\n${source}\n\`\`\``)
    .join("\n\n") || "No Python source context found.";
}

function extractResponseText(payload: unknown) {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.text === "string") chunks.push(item.text);
    const content = Array.isArray(item.content) ? item.content : [];
    for (const contentItem of content) {
      if (!isRecord(contentItem)) continue;
      if (typeof contentItem.text === "string") chunks.push(contentItem.text);
    }
  }
  return chunks.join("\n");
}

function getOpenAIErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : null;
  return typeof error?.message === "string" ? error.message : fallback;
}

function getIncompleteReason(payload: unknown) {
  if (!isRecord(payload) || payload.status !== "incomplete") return null;
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : null;
  return typeof details?.reason === "string" ? details.reason : "response was incomplete";
}

function getProviderLabel(provider: JudgeProvider) {
  return provider === "openai" ? "OpenAI" : "LiteLLM";
}

function getNonNegativeTokenCount(value: unknown) {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function normalizePricedModel(model: string) {
  const normalized = model.toLowerCase().replace(/^openai\//, "");
  return Object.keys(TOKEN_PRICES_PER_MILLION)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`));
}

function getTokenPrices(
  model: string,
  serviceTier: string | undefined,
  inputTokens: number,
) {
  const pricedModel = normalizePricedModel(model);
  if (!pricedModel) return null;

  const normalizedTier = serviceTier?.toLowerCase();
  const pricingTier = normalizedTier === "flex" || normalizedTier === "priority" || normalizedTier === "ultrafast"
    ? normalizedTier
    : normalizedTier === "fast"
      ? "priority"
    : normalizedTier === undefined || normalizedTier === "default" || normalizedTier === "auto"
      ? "default"
      : null;
  if (!pricingTier) return null;

  const prices = TOKEN_PRICES_PER_MILLION[pricedModel]?.[pricingTier];
  if (!prices) return null;
  if (
    inputTokens <= LONG_CONTEXT_INPUT_TOKEN_THRESHOLD
    || !LONG_CONTEXT_PRICED_JUDGE_MODELS.has(pricedModel)
  ) return prices;

  return {
    input: prices.input * 2,
    cached_input: prices.cached_input * 2,
    cache_write: prices.cache_write * 2,
    output: prices.output * 1.5,
  };
}

function getJudgeUsageMetrics(
  payload: unknown,
  metadata: JudgeRequestMetadata,
): JudgeUsageMetrics {
  const payloadRecord = isRecord(payload) ? payload : {};
  const usage = isRecord(payloadRecord.usage) ? payloadRecord.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const inputTokens = getNonNegativeTokenCount(usage.input_tokens);
  const cachedTokens = getNonNegativeTokenCount(inputDetails.cached_tokens);
  const cacheWriteTokens = getNonNegativeTokenCount(inputDetails.cache_write_tokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens);
  const outputTokens = getNonNegativeTokenCount(usage.output_tokens);
  const reasoningTokens = getNonNegativeTokenCount(outputDetails.reasoning_tokens);
  const reportedTotalTokens = getNonNegativeTokenCount(usage.total_tokens);
  const totalTokens = reportedTotalTokens || inputTokens + outputTokens;
  const serviceTier = typeof payloadRecord.service_tier === "string"
    ? payloadRecord.service_tier
    : undefined;
  const responseModel = typeof payloadRecord.model === "string"
    ? payloadRecord.model
    : metadata.judge_model_used;
  const prices = metadata.judge_provider === "openai"
    ? getTokenPrices(responseModel, serviceTier, inputTokens)
    : null;
  const uncachedInputCost = prices
    ? (uncachedInputTokens / 1_000_000) * prices.input
    : null;
  const cachedInputCost = prices
    ? (cachedTokens / 1_000_000) * prices.cached_input
    : null;
  const cacheWriteCost = prices
    ? (cacheWriteTokens / 1_000_000) * prices.cache_write
    : null;
  const outputCost = prices
    ? (outputTokens / 1_000_000) * prices.output
    : null;
  const reasoningCost = prices
    ? (reasoningTokens / 1_000_000) * prices.output
    : null;
  const inputCost = uncachedInputCost === null || cachedInputCost === null || cacheWriteCost === null
    ? null
    : uncachedInputCost + cachedInputCost + cacheWriteCost;
  const totalCost = inputCost === null || outputCost === null
    ? null
    : inputCost + outputCost;

  return {
    input_tokens: inputTokens,
    uncached_input_tokens: uncachedInputTokens,
    cached_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    input_cost: inputCost,
    uncached_input_cost: uncachedInputCost,
    cached_input_cost: cachedInputCost,
    cache_write_cost: cacheWriteCost,
    output_cost: outputCost,
    reasoning_cost: reasoningCost,
    total_cost: totalCost,
    judge_usage: usage,
    ...(serviceTier ? { judge_service_tier: serviceTier } : {}),
  };
}

function withJudgeMetadata(
  error: Error,
  metadata: JudgeRequestMetadata,
  usage?: JudgeUsageMetrics,
): EvalJudgeError {
  return Object.assign(error, metadata, usage);
}

function parseStructuredResponseJson(payload: unknown, label: string) {
  const incompleteReason = getIncompleteReason(payload);
  if (incompleteReason) {
    throw new Error(`${label} returned an incomplete response (${incompleteReason}). Try again or reduce the input size.`);
  }

  const text = extractResponseText(payload).trim();
  if (!text) throw new Error(`${label} returned an empty response.`);

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unexpected end of JSON input")) {
      throw new Error(`${label} returned incomplete JSON. Try again or reduce the input size.`);
    }
    throw new Error(`${label} returned invalid JSON: ${message}`);
  }
}

function normalizeJudgeResult(
  traceId: string,
  value: unknown,
): Omit<EvalJudgeResult, keyof JudgeRequestMetadata | keyof JudgeUsageMetrics> {
  if (!isRecord(value)) throw new Error("Judge response was not a JSON object.");
  const verdict = value.verdict === "pass" ? "pass" : value.verdict === "fail" ? "fail" : null;
  if (!verdict) throw new Error("Judge response must include verdict pass/fail.");

  const score = typeof value.score === "number" ? value.score : Number(value.score);
  if (!Number.isFinite(score)) throw new Error("Judge response must include a numeric score.");

  const hallucinationScore = typeof value.hallucination_score === "number"
    ? value.hallucination_score
    : Number(value.hallucination_score);
  if (!Number.isFinite(hallucinationScore)) {
    throw new Error("Judge response must include a numeric hallucination_score.");
  }

  return {
    trace_id: traceId,
    verdict,
    score: Math.max(0, Math.min(10, score)),
    hallucination_score: Math.max(0, Math.min(10, hallucinationScore)),
    hallucination_reasoning: typeof value.hallucination_reasoning === "string"
      ? value.hallucination_reasoning
      : "No hallucination reasoning returned.",
    trace_summary: typeof value.trace_summary === "string"
      ? value.trace_summary
      : "No trace summary returned.",
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "No reasoning returned.",
    strengths: Array.isArray(value.strengths) ? value.strengths.map(String) : [],
    issues: Array.isArray(value.issues) ? value.issues.map(String) : [],
  };
}

type PromptImprovementDraft = Omit<PromptImprovementChange, "original_prompt">;

function normalizePromptImprovementResult(value: unknown): PromptImprovementDraft[] {
  if (!isRecord(value)) throw new Error("Prompt improvement response was not a JSON object.");

  return Array.isArray(value.prompt_changes)
    ? value.prompt_changes
        .filter(isRecord)
        .map((change) => ({
          target_file: typeof change.target_file === "string" ? change.target_file : "",
          target_agent: typeof change.target_agent === "string" ? change.target_agent : "",
          prompt_name: typeof change.prompt_name === "string" ? change.prompt_name : "",
          proposed_prompt: typeof change.proposed_prompt === "string" ? change.proposed_prompt : "",
          reasoning: typeof change.reasoning === "string" ? change.reasoning : "",
        }))
        .filter((change) => (
          change.target_file.trim()
          && change.target_agent.trim()
          && change.prompt_name.trim()
          && change.proposed_prompt.trim()
          && change.reasoning.trim()
        ))
    : [];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readPromptConstant(targetFile: string, promptName: string) {
  const absolutePath = path.resolve(repoRoot, targetFile);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (
    !relativePath
    || relativePath.startsWith("..")
    || path.isAbsolute(relativePath)
    || path.extname(absolutePath) !== ".py"
  ) {
    return null;
  }

  let source: string;
  try {
    source = await fs.readFile(absolutePath, "utf-8");
  } catch {
    return null;
  }

  const promptPattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(promptName)}\\s*=\\s*(?:[rRuUbBfF]{0,2})?((?:\"\"\")|(?:'''))([\\s\\S]*?)\\1(?:\\.strip\\(\\))?`,
  );
  const match = source.match(promptPattern);
  return match?.[2]?.trim() || null;
}

export async function evaluateTraceWithJudge(
  trace: TraceRecord,
  judgeContext: string,
  judgeModel = "openai/gpt-6.1-sol",
): Promise<EvalJudgeResult> {
  const evalTrace = buildTraceForEval(trace);
  const { response, metadata } = await postJudgeResponses(
    {
      instructions: judgeContext,
      ...getTraceEvalInput(evalTrace, judgeContext, judgeModel),
      text: {
        format: {
          type: "json_schema",
          name: "trace_eval_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "verdict",
              "score",
              "hallucination_score",
              "hallucination_reasoning",
              "trace_summary",
              "reasoning",
              "strengths",
              "issues",
            ],
            properties: {
              verdict: { type: "string", enum: ["pass", "fail"] },
              score: { type: "number", minimum: 0, maximum: 10 },
              hallucination_score: {
                type: "number",
                minimum: 0,
                maximum: 10,
                description: "0 means no unsupported or fabricated claims; 10 means severe hallucination.",
              },
              hallucination_reasoning: {
                type: "string",
                maxLength: TRACE_EVAL_REASONING_MAX_CHARS,
                description: "Keep this concise and evidence-grounded.",
              },
              trace_summary: {
                type: "string",
                maxLength: TRACE_EVAL_SUMMARY_MAX_CHARS,
                description: "Factual summary of the trace's task, key workflow and tool steps, and final outcome. Do not evaluate quality here.",
              },
              reasoning: {
                type: "string",
                maxLength: TRACE_EVAL_REASONING_MAX_CHARS,
                description: "Keep this concise and evidence-grounded.",
              },
              strengths: {
                type: "array",
                maxItems: TRACE_EVAL_LIST_MAX_ITEMS,
                items: {
                  type: "string",
                  maxLength: TRACE_EVAL_LIST_ITEM_MAX_CHARS,
                },
              },
              issues: {
                type: "array",
                maxItems: TRACE_EVAL_LIST_MAX_ITEMS,
                items: {
                  type: "string",
                  maxLength: TRACE_EVAL_LIST_ITEM_MAX_CHARS,
                },
              },
            },
          },
        },
      },
      max_output_tokens: TRACE_EVAL_MAX_OUTPUT_TOKENS,
    },
    judgeModel,
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  const usage = getJudgeUsageMetrics(payload, metadata);
  if (!response.ok) {
    throw withJudgeMetadata(
      new Error(getOpenAIErrorMessage(payload, `${getProviderLabel(metadata.judge_provider)} eval request failed: ${response.status}`)),
      metadata,
      usage,
    );
  }

  try {
    return {
      ...normalizeJudgeResult(trace.trace_id, parseStructuredResponseJson(payload, "Judge")),
      ...metadata,
      ...usage,
    };
  } catch (error) {
    throw withJudgeMetadata(error instanceof Error ? error : new Error(String(error)), metadata, usage);
  }
}

export async function recommendPromptImprovements(
  evalResults: unknown[],
  traceIds: string[] = [],
  judgeModel = "openai/gpt-6.1-sol",
): Promise<PromptImprovementResult> {
  const sourceContext = await buildSourceContext();
  const addedContext = await readEvalContextMarkdown();
  const { response, metadata } = await postJudgeResponses(
    {
      instructions: `You are a senior prompt optimization engineer for an OpenAI Agents SDK workflow.

Use the judge outputs and current source files to propose only material changes to agent instruction prompts. The full traces are intentionally omitted to keep the analysis focused and avoid context overflow.

Return at most one complete proposed prompt for each affected prompt constant. Merge related improvements into that one proposal. Preserve unrelated instructions verbatim and make the smallest change that addresses evidence in the judge output. Do not recommend a prompt change for an issue that requires code, tools, fixtures, or evaluation changes instead.

For each change:
- identify the exact repository file, agent, and Python prompt constant;
- provide the complete proposed prompt text, without Python assignment syntax or quote delimiters; and
- provide one concise reasoning paragraph explaining the trace evidence, what changed, and why the change should improve behavior.

Do not return summaries, risk ratings, recommendation lists, expected-impact sections, cross-workflow patterns, eval ideas, or a textual diff. The application will load the exact original prompt from the repository and generate the visual diff itself. Return an empty prompt_changes array when no material prompt change is justified.

Return only JSON that matches the schema.`,
      input: `## Added Evaluation Context\n${addedContext || "No dashboard-added evaluation context."}\n\n## Judge Outputs\n${JSON.stringify(evalResults, null, 2)}\n\n## Trace IDs Available For References\n${JSON.stringify(traceIds, null, 2)}\n\n## Source Files\n${sourceContext}`,
      text: {
        format: {
          type: "json_schema",
          name: "prompt_improvement_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["prompt_changes"],
            properties: {
              prompt_changes: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "target_file",
                    "target_agent",
                    "prompt_name",
                    "proposed_prompt",
                    "reasoning",
                  ],
                  properties: {
                    target_file: { type: "string" },
                    target_agent: { type: "string" },
                    prompt_name: {
                      type: "string",
                      description: "Exact Python constant containing the current prompt.",
                    },
                    proposed_prompt: {
                      type: "string",
                      description: "Complete proposed prompt text without Python syntax or quote delimiters.",
                    },
                    reasoning: {
                      type: "string",
                      maxLength: 1200,
                      description: "Concise evidence-based reason for this prompt change.",
                    },
                  },
                },
              },
            },
          },
        },
      },
      max_output_tokens: 9000,
    },
    judgeModel,
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  const usage = getJudgeUsageMetrics(payload, metadata);
  if (!response.ok) {
    throw withJudgeMetadata(
      new Error(getOpenAIErrorMessage(payload, `${getProviderLabel(metadata.judge_provider)} prompt improvement request failed: ${response.status}`)),
      metadata,
      usage,
    );
  }

  try {
    const drafts = normalizePromptImprovementResult(
      parseStructuredResponseJson(payload, "Prompt improvement model"),
    );
    const promptChanges = await Promise.all(
      drafts.map(async (draft) => ({
        ...draft,
        original_prompt: await readPromptConstant(draft.target_file, draft.prompt_name),
      })),
    );
    const unresolvedPrompts = promptChanges.filter((change) => !change.original_prompt);
    if (unresolvedPrompts.length) {
      throw new Error(
        `Prompt improvement model referenced prompt constants that could not be found: ${
          unresolvedPrompts
            .map((change) => `${change.target_file}:${change.prompt_name}`)
            .join(", ")
        }.`,
      );
    }

    return {
      prompt_changes: promptChanges
        .filter((change): change is PromptImprovementChange => (
          Boolean(change.original_prompt)
          && change.original_prompt?.trim() !== change.proposed_prompt.trim()
        ))
        .map((change) => ({
          ...change,
          original_prompt: change.original_prompt,
        })),
      ...metadata,
      ...usage,
    };
  } catch (error) {
    throw withJudgeMetadata(error instanceof Error ? error : new Error(String(error)), metadata, usage);
  }
}
