"use client";

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KpiPanel } from "./KpiPanel";
import { KnowledgeDocumentBody } from "./KnowledgeDocumentBody";
import { PrivateNoteBody } from "./PrivateNoteBody";
import type { TicketActor, TicketMessage, FreshserviceTicket, RuntimeData } from "@/lib/runtimeDataTypes";
import type { SpanRecord, TraceAttachment, TraceEvent, TraceRecord, TraceSummary } from "@/lib/types";

type SelectedDetail =
  | { kind: "event"; value: TraceEvent }
  | { kind: "span"; value: SpanRecord }
  | { kind: "trace"; value: TraceRecord };

type SpanNode = {
  span: SpanRecord;
  children: SpanNode[];
};

type AttachmentPreview = {
  attachment: TraceAttachment;
  attachments?: TraceAttachment[];
  currentIndex?: number;
  href: string;
  label: string;
};

type TimelineRange = {
  start: number;
  end: number;
};

type EvalRunResult = {
  trace_id: string;
  verdict?: "pass" | "fail";
  score?: number;
  hallucination_score?: number;
  hallucination_reasoning?: string;
  trace_summary?: string;
  reasoning?: string;
  strengths?: string[];
  issues?: string[];
  judge_provider?: "litellm" | "openai";
  judge_model_requested?: string;
  judge_model_used?: string;
  judge_fallback_used?: boolean;
  judge_api_key_source?: JudgeApiKeySource;
  input_tokens?: number;
  uncached_input_tokens?: number;
  cached_tokens?: number;
  cache_write_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  input_cost?: number | null;
  uncached_input_cost?: number | null;
  cached_input_cost?: number | null;
  cache_write_cost?: number | null;
  output_cost?: number | null;
  reasoning_cost?: number | null;
  total_cost?: number | null;
  judge_usage?: Record<string, unknown>;
  judge_service_tier?: string;
  error?: string;
};

type JudgeBackendProvider = "litellm" | "openai" | "unavailable";
type JudgeApiKeySource = "dashboard" | "default";

type JudgeModelsResponse = {
  models: string[];
  provider: JudgeBackendProvider;
  using_fallback: boolean;
  judge_api_key_source?: JudgeApiKeySource;
  error?: string;
};

type JudgePromptResponse = {
  prompt: string;
  default_prompt: string;
  prompt_path: string;
  default_prompt_path: string;
  customized: boolean;
  error?: string;
};

type EvalContextDocument = {
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

type EvalContextResponse = {
  status: "empty" | "ready";
  documents: EvalContextDocument[];
  context_path: string;
  context_chars: number;
  error?: string;
};

type PromptImprovementChange = {
  target_file: string;
  target_agent: string;
  prompt_name: string;
  original_prompt: string;
  proposed_prompt: string;
  reasoning: string;
};

type PromptImprovementResult = {
  prompt_changes: PromptImprovementChange[];
  judge_provider: "litellm" | "openai";
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

type AgentRunResult = {
  workflow_output?: unknown;
  input_payload?: unknown;
  trace_id: string;
  trace_url?: string;
  session_id?: string;
  scenario_id?: string;
  status?: string;
  ticket_id?: string;
  ticket?: FreshserviceTicket | null;
  conversation?: TicketMessage[];
};

type RunContext = {
  ticket_id: string | null;
  ticket: FreshserviceTicket | null;
  conversation: TicketMessage[];
};

type RuntimeResetResponse = {
  status: "restored";
  restored_files: number;
};

type RunContextLookup = { ticket_id?: string };

type PersistedRunState = {
  version: 3;
  selected_scenario_id: string;
  workflow_result: AgentRunResult | null;
  workflow_error: string | null;
  live_context: RunContext | null;
  context_lookup: RunContextLookup | null;
};

type PersistedEvalState = {
  version: 1;
  results: EvalRunResult[];
};

type RunSnapshot = {
  version: 1;
  captured_at: string;
  result: AgentRunResult;
  context: RunContext;
  selected_scenario_id: string;
  exact: boolean;
};

type ScenarioOption = {
  id: string;
  description: string;
  payloads: Array<Record<string, unknown>>;
};

type EvalStreamMessage =
  | { type: "result"; result: EvalRunResult }
  | { type: "done" }
  | { type: "error"; error: string };

type WorkflowStreamMessage =
  | { type: "connected" | "heartbeat" }
  | { type: "result"; result: AgentRunResult }
  | { type: "error"; error: string; detail?: unknown; status_code?: number };

type DashboardView = "runs" | "traces" | "evals" | "data" | "kpis";

type SpanKindFilter = "all" | "agent" | "tool" | "model" | "guardrail" | "span";
type SpanQuickFilter = "all" | "files" | "slow" | "cost" | "triggered";

type CollapsedSpanKind = Exclude<SpanKindFilter, "all">;

type TraceStatusFilter = "all" | "running" | "completed" | "errors";

type SpanFilters = {
  search: string;
  kind: SpanKindFilter;
  quickFilter: SpanQuickFilter;
};

type RelativeSpanFilterSets = {
  slowSpanIds: Set<string>;
  costlySpanIds: Set<string>;
};

type PaneLayout = {
  inspectorWidth: number;
};

type PdfMeta = {
  page_count?: number;
  file_name?: string;
  content_type?: string;
};

const DEFAULT_SPAN_FILTERS: SpanFilters = {
  search: "",
  kind: "all",
  quickFilter: "all",
};
const DEFAULT_PANE_LAYOUT: PaneLayout = {
  inspectorWidth: 390,
};
const COLLAPSIBLE_SPAN_KINDS: CollapsedSpanKind[] = ["agent", "tool", "model", "guardrail", "span"];
const LOCAL_STORAGE_KEYS = {
  activeView: "local-agents-active-view",
  collapsedSpanTypes: "local-agents-collapsed-span-types",
  paneLayout: "local-agents-pane-layout",
  currentRun: "local-agents-current-run",
  latestEval: "local-agents-latest-eval",
  theme: "local-agents-theme",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecordString(record: Record<string, unknown>, field: string) {
  return typeof record[field] === "string" ? record[field] : "";
}

function normalizeRunContext(value: unknown): RunContext | null {
  if (!isRecord(value)) return null;
  const ticket = isRecord(value.ticket) && typeof value.ticket.id === "string"
    && isRecord(value.ticket.requester)
    ? value.ticket as unknown as FreshserviceTicket : null;
  return {
    ticket_id: getRecordString(value, "ticket_id") || ticket?.id || null,
    ticket,
    conversation: ticket?.conversation ?? (Array.isArray(value.conversation) ? value.conversation as TicketMessage[] : []),
  };
}

function actorLabel(actor: TicketActor) {
  return actor.name || actor.email || actor.id;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function parseRunSnapshot(value: unknown): RunSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.result) || !isRecord(value.context)) {
    return null;
  }
  if (typeof value.result.trace_id !== "string") return null;
  const context = normalizeRunContext(value.context);
  if (!context) return null;
  return { ...value, context, exact: value.exact === true && context.ticket !== null } as unknown as RunSnapshot;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getSpanOutputRecords(span: SpanRecord) {
  const response = isRecord(span.response) ? span.response : null;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return [];
    return item.content.flatMap((content) => {
      if (!isRecord(content)) return [];
      const parsed = parseJsonRecord(content.text);
      return parsed ? [parsed] : [];
    });
  });
}

function buildTraceRunFallback(trace: TraceRecord): RunSnapshot | null {
  const orderedSpans = [...trace.spans].sort((left, right) => {
    const leftTime = Date.parse(left.ended_at ?? left.started_at ?? "");
    const rightTime = Date.parse(right.ended_at ?? right.started_at ?? "");
    return (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
  });
  const workflowOutput = orderedSpans
    .flatMap(getSpanOutputRecords)
    .filter((output) => (
      typeof output.status === "string"
      && (typeof output.ticket_id === "string" || typeof output.summary === "string")
    ))
    .at(-1) ?? null;
  if (!workflowOutput) return null;

  const ticketId = getRecordString(workflowOutput, "ticket_id") || null;
  return {
    version: 1,
    captured_at: trace.ended_at ?? trace.updated_at ?? new Date().toISOString(),
    result: {
      workflow_output: workflowOutput,
      trace_id: trace.trace_id,
      status: getRecordString(workflowOutput, "status") || trace.status,
      ticket_id: ticketId ?? undefined,
    },
    context: {
      ticket_id: ticketId,
      ticket: null,
      conversation: [],
    },
    selected_scenario_id: "",
    exact: false,
  };
}

async function saveRunSnapshot(traceId: string, snapshot: RunSnapshot) {
  const response = await fetch(`/api/traces/${encodeURIComponent(traceId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_snapshot: snapshot }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : `Run history save failed: ${response.status}`;
    throw new Error(message);
  }
}

function formatJudgeProvider(provider?: "litellm" | "openai") {
  if (provider === "openai") return "OpenAI";
  if (provider === "litellm") return "LiteLLM";
  return "Unavailable";
}

function formatJudgeBackend(provider: JudgeBackendProvider, usingFallback: boolean) {
  if (provider === "unavailable") return "Unavailable";
  return formatJudgeProvider(provider);
}

function formatJudgeApiKeySource(source: JudgeApiKeySource) {
  return source === "dashboard" ? "Dashboard key" : "Default key";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (!response.ok) return null;
    throw new Error("Server returned invalid JSON.");
  }
}

function parseWorkflowStreamBlock(block: string): WorkflowStreamMessage | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new Error("Workflow stream returned an invalid event.");
  }
  if (!isRecord(payload) || typeof payload.type !== "string") {
    throw new Error("Workflow stream returned an invalid event.");
  }
  return payload as WorkflowStreamMessage;
}

async function readWorkflowRunResponse(
  response: Response,
  fallbackError: string,
): Promise<AgentRunResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const payload = await readJsonResponse<AgentRunResult | { error?: string }>(response);
    if (!response.ok) {
      const message = payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : fallbackError;
      throw new Error(message);
    }
    if (!payload) throw new Error("Workflow run returned an empty response.");
    return payload as AgentRunResult;
  }
  if (!response.body) throw new Error("Workflow stream returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFinished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      if (done) {
        buffer += decoder.decode();
        streamFinished = true;
      }
      buffer = buffer.replaceAll("\r\n", "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseWorkflowStreamBlock(block);
        if (message?.type === "error") throw new Error(message.error || fallbackError);
        if (message?.type === "result") return message.result;
        boundary = buffer.indexOf("\n\n");
      }

      if (done) break;
    }

    const finalMessage = parseWorkflowStreamBlock(buffer);
    if (finalMessage?.type === "error") throw new Error(finalMessage.error || fallbackError);
    if (finalMessage?.type === "result") return finalMessage.result;
    throw new Error("Workflow stream closed before returning a result.");
  } finally {
    if (!streamFinished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function shortTraceId(traceId: string) {
  if (traceId.length <= 18) return traceId;
  return `${traceId.slice(0, 10)}...${traceId.slice(-6)}`;
}

function getTraceDisplayName(trace: { trace_id: string; workflow_name?: string }) {
  return trace.workflow_name?.trim() || shortTraceId(trace.trace_id);
}

function getTraceSubheading(trace: { trace_id: string; workflow_name?: string }) {
  return trace.workflow_name?.trim() ? trace.trace_id : undefined;
}

function TraceName({
  trace,
  compact = false,
}: {
  trace: { trace_id: string; workflow_name?: string };
  compact?: boolean;
}) {
  const subheading = getTraceSubheading(trace);
  return (
    <span className={`trace-name ${compact ? "is-compact" : ""}`}>
      <strong>{getTraceDisplayName(trace)}</strong>
      {subheading ? <code>{subheading}</code> : null}
    </span>
  );
}

function formatTime(value?: string) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatMs(value?: number) {
  if (typeof value !== "number") return "n/a";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatNumber(value?: number) {
  if (typeof value !== "number") return "0";
  return new Intl.NumberFormat().format(value);
}

function formatCost(value?: number) {
  if (typeof value !== "number") return "$0.0000";
  if (value > 0 && value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

function TraceSidebarTooltip({
  summary,
  anchor,
  tooltipId,
}: {
  summary: TraceSummary;
  anchor: HTMLDivElement;
  tooltipId: string;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const gap = 10;
      const padding = 12;
      const right = rect.right + gap;
      const left = rect.left - width - gap;
      const preferredLeft = right + width <= window.innerWidth - padding
        ? right
        : left >= padding ? left : rect.left;

      setPosition({
        left: Math.max(padding, Math.min(preferredLeft, window.innerWidth - width - padding)),
        top: Math.max(padding, Math.min(rect.top, window.innerHeight - height - padding)),
      });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(tooltip);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  const finishedLabel = summary.status === "running" ? "Last updated" : "Finished";
  const finishedValue = summary.status === "running" ? summary.updated_at : summary.ended_at;
  const costBasis = summary.cost_source === "cost_summary"
    ? "Recorded run total"
    : "Visible span estimate";

  return createPortal(
    <div
      ref={tooltipRef}
      className="trace-sidebar-tooltip"
      id={tooltipId}
      role="tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
    >
      <div className="trace-sidebar-tooltip-header">
        <strong>{getTraceDisplayName(summary)}</strong>
        <StatusPill status={summary.status} />
      </div>
      <code>{summary.trace_id}</code>
      <dl>
        <div><dt>Started</dt><dd>{formatDateTime(summary.started_at)}</dd></div>
        <div><dt>{finishedLabel}</dt><dd>{formatDateTime(finishedValue)}</dd></div>
        <div><dt>Duration</dt><dd>{formatMs(summary.duration_ms)}</dd></div>
        <div><dt>Events</dt><dd>{formatNumber(summary.event_count)}</dd></div>
        <div><dt>Spans</dt><dd>{formatNumber(summary.span_count)}</dd></div>
        <div><dt>Agents</dt><dd>{formatNumber(summary.agent_count)}</dd></div>
        <div><dt>Tools</dt><dd>{formatNumber(summary.tool_count)}</dd></div>
        <div><dt>Guardrails</dt><dd>{formatNumber(summary.guardrail_count)}</dd></div>
        <div><dt>Errors</dt><dd>{formatNumber(summary.error_count)}</dd></div>
        <div><dt>Tokens</dt><dd>{formatNumber(summary.total_tokens)}</dd></div>
        <div className="trace-sidebar-tooltip-cost"><dt>Cost</dt><dd>{formatCost(summary.total_cost)}</dd></div>
        <div><dt>Cost basis</dt><dd>{costBasis}</dd></div>
      </dl>
    </div>,
    document.body,
  );
}

function TraceSidebarItem({
  summary,
  selected,
  batchSelected,
  managementMode,
  onToggleBatch,
  onSelect,
}: {
  summary: TraceSummary;
  selected: boolean;
  batchSelected: boolean;
  managementMode: boolean;
  onToggleBatch: () => void;
  onSelect: () => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLDivElement | null>(null);

  const showTooltip = () => setTooltipAnchor(itemRef.current);

  return (
    <div
      ref={itemRef}
      className={`trace-item ${selected ? "is-selected" : ""} ${
        batchSelected ? "is-batch-selected" : ""
      } ${summary.error_count > 0 ? "has-errors" : ""}`}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipAnchor(null)}
      onFocusCapture={showTooltip}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setTooltipAnchor(null);
        }
      }}
      aria-describedby={tooltipAnchor ? tooltipId : undefined}
    >
      <div className="trace-item-main">
        <input
          type="checkbox"
          checked={batchSelected}
          onChange={onToggleBatch}
          disabled={!managementMode}
          aria-label={`Select trace ${getTraceDisplayName(summary)}`}
        />
        <button className="trace-select-button" onClick={onSelect}>
          <div className="trace-item-top">
            <TraceName trace={summary} compact />
            <StatusPill status={summary.status} />
            {summary.error_count > 0 ? <ErrorPill count={summary.error_count} /> : null}
          </div>
          <div className="trace-item-meta">
            <span>{summary.event_count} ev · {summary.span_count} spans · {formatMs(summary.duration_ms)}</span>
            <span>{formatNumber(summary.total_tokens)}t · {formatCost(summary.total_cost)}</span>
          </div>
        </button>
      </div>
      {tooltipAnchor ? (
        <TraceSidebarTooltip
          summary={summary}
          anchor={tooltipAnchor}
          tooltipId={tooltipId}
        />
      ) : null}
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character] ?? character,
  );
}

function buildReportTextBlock(label: string, value?: string) {
  if (!value?.trim()) return "";
  return `
    <section class="text-block">
      <h4>${escapeHtml(label)}</h4>
      <p>${escapeHtml(value)}</p>
    </section>
  `;
}

function buildReportList(label: string, items?: string[]) {
  if (!items?.length) return "";
  return `
    <section class="finding-list">
      <h4>${escapeHtml(label)}</h4>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function buildReportPromptDiff(change: PromptImprovementChange) {
  const lines = buildPromptDiff(change.original_prompt, change.proposed_prompt);
  if (!lines.length) {
    return '<p class="empty">The proposed prompt is identical to the current prompt.</p>';
  }

  return `
    <div class="diff">
      ${lines.map((line) => {
        if (line.kind === "separator") {
          return `<div class="diff-separator">${escapeHtml(line.text)}</div>`;
        }
        const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
        return `
          <div class="diff-line ${line.kind}">
            <span>${line.oldLine ?? ""}</span>
            <span>${line.newLine ?? ""}</span>
            <b>${marker}</b>
            <code>${escapeHtml(line.text || " ")}</code>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildEvalReportHtml(
  evalResults: EvalRunResult[],
  promptImprovement: PromptImprovementResult | null,
  summaries: TraceSummary[],
) {
  const generatedAt = new Date();
  const summaryByTraceId = new Map(summaries.map((summary) => [summary.trace_id, summary]));
  const successfulResults = evalResults.filter(
    (result) => !result.error && typeof result.score === "number",
  );
  const passCount = evalResults.filter((result) => result.verdict === "pass").length;
  const failCount = evalResults.filter((result) => result.verdict === "fail").length;
  const errorCount = evalResults.filter((result) => result.error).length;
  const averageScore = successfulResults.length
    ? successfulResults.reduce((total, result) => total + (result.score ?? 0), 0) / successfulResults.length
    : null;
  const passRate = successfulResults.length ? (passCount / successfulResults.length) * 100 : null;

  const resultSections = evalResults.map((result) => {
    const summary = summaryByTraceId.get(result.trace_id);
    const traceName = getTraceDisplayName(summary ?? { trace_id: result.trace_id });
    const verdict = result.error ? "error" : result.verdict ?? "unknown";
    const judge = [
      result.judge_provider
        ? formatJudgeBackend(result.judge_provider, Boolean(result.judge_fallback_used))
        : "",
      result.judge_model_used,
      result.judge_service_tier ? `${result.judge_service_tier} tier` : "",
    ].filter(Boolean).join(" · ");

    return `
      <article class="result-card">
        <header>
          <div>
            <p class="eyebrow">Trace evaluation</p>
            <h3>${escapeHtml(traceName)}</h3>
            <code>${escapeHtml(result.trace_id)}</code>
          </div>
          <span class="verdict ${escapeHtml(verdict)}">${escapeHtml(verdict)}</span>
        </header>
        <div class="metrics">
          <div><span>Score</span><strong>${typeof result.score === "number" ? result.score.toFixed(1) : "n/a"}</strong></div>
          <div><span>Hallucination</span><strong>${typeof result.hallucination_score === "number" ? result.hallucination_score.toFixed(1) : "n/a"}</strong></div>
          <div><span>Judge</span><strong>${escapeHtml(judge || "n/a")}</strong></div>
        </div>
        ${buildReportTextBlock("Trace summary", result.trace_summary)}
        ${buildReportTextBlock(result.error ? "Error" : "Reasoning", result.error ?? result.reasoning)}
        ${buildReportTextBlock("Hallucination review", result.hallucination_reasoning)}
        <div class="findings">
          ${buildReportList("Strengths", result.strengths)}
          ${buildReportList("Issues", result.issues)}
        </div>
      </article>
    `;
  }).join("");

  let recommendationSections = `
    <div class="empty">Prompt recommendations have not been generated for these results.</div>
  `;
  if (promptImprovement) {
    recommendationSections = promptImprovement.prompt_changes.length
      ? promptImprovement.prompt_changes.map((change) => `
        <article class="recommendation-card">
          <header>
            <div>
              <p class="eyebrow">${escapeHtml(change.target_file)}</p>
              <h3>${escapeHtml(change.target_agent)}</h3>
              <code>${escapeHtml(change.prompt_name)}</code>
            </div>
          </header>
          ${buildReportTextBlock("Why this changed", change.reasoning)}
          <h4>Changes</h4>
          ${buildReportPromptDiff(change)}
          <h4>Proposed prompt</h4>
          <pre>${escapeHtml(change.proposed_prompt)}</pre>
          <details>
            <summary>Current prompt</summary>
            <pre>${escapeHtml(change.original_prompt)}</pre>
          </details>
        </article>
      `).join("")
      : '<div class="empty">No material prompt changes were recommended.</div>';
  }

  const recommendationJudge = promptImprovement
    ? [
        formatJudgeBackend(promptImprovement.judge_provider, promptImprovement.judge_fallback_used),
        promptImprovement.judge_model_used,
        promptImprovement.judge_service_tier ? `${promptImprovement.judge_service_tier} tier` : "",
      ].filter(Boolean).join(" · ")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Evaluation report · ${escapeHtml(generatedAt.toISOString())}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #eef3f8; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f8; color: #172033; line-height: 1.55; }
    main { width: min(1120px, calc(100% - 40px)); margin: 40px auto 72px; }
    .report-header, .result-card, .recommendation-card, .empty { border: 1px solid #ced9e5; border-radius: 14px; background: #fff; box-shadow: 0 12px 32px rgba(30, 55, 80, .07); }
    .report-header { padding: 28px; }
    .report-header h1, h2, h3, h4, p { margin-top: 0; }
    .report-header h1 { margin-bottom: 8px; font-size: 30px; }
    .report-header > p { margin-bottom: 0; color: #66758a; }
    .eyebrow { margin-bottom: 4px; color: #087f78; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .summary-grid, .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
    .summary-grid > div, .metrics > div { border: 1px solid #dbe4ed; border-radius: 10px; padding: 12px; background: #f8fafc; }
    .summary-grid span, .metrics span { display: block; color: #66758a; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .summary-grid strong, .metrics strong { display: block; margin-top: 3px; overflow-wrap: anywhere; font-size: 20px; }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 16px 0; }
    .metrics strong { font-size: 14px; }
    .report-section { margin-top: 34px; }
    .section-heading { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 14px; }
    .section-heading h2 { margin-bottom: 0; font-size: 22px; }
    .section-heading p { margin-bottom: 0; color: #66758a; font-size: 13px; }
    .result-card, .recommendation-card { margin-bottom: 14px; padding: 22px; break-inside: avoid; }
    .result-card > header, .recommendation-card > header { display: flex; justify-content: space-between; gap: 20px; align-items: start; }
    .result-card h3, .recommendation-card h3 { margin-bottom: 3px; font-size: 18px; }
    code { color: #40526a; overflow-wrap: anywhere; }
    .verdict { border-radius: 999px; padding: 6px 11px; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .verdict.pass { background: #dff7ee; color: #087f5b; }
    .verdict.fail, .verdict.error { background: #ffe5e5; color: #b42318; }
    .verdict.unknown { background: #edf1f5; color: #66758a; }
    .text-block { margin-top: 12px; border: 1px solid #dbe4ed; border-radius: 10px; padding: 14px; }
    .text-block h4, .finding-list h4, .recommendation-card > h4 { margin-bottom: 6px; color: #66758a; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .text-block p { margin-bottom: 0; white-space: pre-wrap; }
    .findings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .finding-list { border: 1px solid #dbe4ed; border-radius: 10px; padding: 14px; }
    .finding-list ul { margin: 0; padding-left: 20px; }
    .empty { padding: 24px; color: #66758a; }
    .diff { overflow: hidden; margin: 8px 0 18px; border: 1px solid #dbe4ed; border-radius: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .diff-line { display: grid; grid-template-columns: 42px 42px 24px minmax(0, 1fr); min-height: 24px; }
    .diff-line > span, .diff-line > b { padding: 3px 6px; color: #718096; text-align: right; user-select: none; }
    .diff-line code { padding: 3px 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .diff-line.added { background: #e7f8ef; }
    .diff-line.removed { background: #fff0f0; }
    .diff-separator { padding: 6px 12px; background: #edf2f7; color: #718096; font-style: italic; }
    pre { overflow: auto; max-height: none; border: 1px solid #dbe4ed; border-radius: 10px; padding: 16px; background: #f8fafc; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    details { margin-top: 14px; }
    summary { cursor: pointer; color: #40526a; font-weight: 700; }
    @media (max-width: 760px) { main { width: min(100% - 20px, 1120px); margin-top: 10px; } .summary-grid, .metrics, .findings { grid-template-columns: 1fr; } }
    @media print { body { background: #fff; } main { width: 100%; margin: 0; } .report-header, .result-card, .recommendation-card, .empty { box-shadow: none; } details > * { display: block; } }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <p class="eyebrow">Local Agents Dashboard</p>
      <h1>Evaluation report</h1>
      <p>Generated ${escapeHtml(generatedAt.toLocaleString())}</p>
      <div class="summary-grid">
        <div><span>Results</span><strong>${evalResults.length}</strong></div>
        <div><span>Pass</span><strong>${passCount}</strong></div>
        <div><span>Fail</span><strong>${failCount}</strong></div>
        <div><span>Errors</span><strong>${errorCount}</strong></div>
        <div><span>Average score</span><strong>${averageScore === null ? "n/a" : averageScore.toFixed(1)}</strong></div>
        <div><span>Pass rate</span><strong>${passRate === null ? "n/a" : `${passRate.toFixed(0)}%`}</strong></div>
      </div>
    </header>
    <section class="report-section">
      <div class="section-heading">
        <h2>Evaluation results</h2>
        <p>${evalResults.length} trace${evalResults.length === 1 ? "" : "s"}</p>
      </div>
      ${resultSections}
    </section>
    <section class="report-section">
      <div class="section-heading">
        <h2>Recommended prompt changes</h2>
        <p>${escapeHtml(recommendationJudge)}</p>
      </div>
      ${recommendationSections}
    </section>
  </main>
</body>
</html>`;
}

function downloadEvalReport(
  evalResults: EvalRunResult[],
  promptImprovement: PromptImprovementResult | null,
  summaries: TraceSummary[],
) {
  const html = buildEvalReportHtml(evalResults, promptImprovement, summaries);
  const reportBlob = new Blob([html], { type: "text/html;charset=utf-8" });
  const reportUrl = URL.createObjectURL(reportBlob);
  const downloadLink = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadLink.href = reportUrl;
  downloadLink.download = `eval-report-${timestamp}.html`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(reportUrl), 0);
}

function parseStoredView(value: string | null): DashboardView {
  if (value === "runs" || value === "traces" || value === "evals" || value === "data" || value === "kpis") return value;
  return "runs";
}

function parseStoredPaneLayout(value: string | null): PaneLayout {
  if (!value) return DEFAULT_PANE_LAYOUT;
  try {
    const parsed = JSON.parse(value) as Partial<PaneLayout>;
    const inspectorWidth = typeof parsed.inspectorWidth === "number" ? parsed.inspectorWidth : DEFAULT_PANE_LAYOUT.inspectorWidth;
    return {
      inspectorWidth: Math.min(Math.max(inspectorWidth, 300), 720),
    };
  } catch {
    return DEFAULT_PANE_LAYOUT;
  }
}

function parseStoredCollapsedSpanTypes(value: string | null): Set<CollapsedSpanKind> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is CollapsedSpanKind => COLLAPSIBLE_SPAN_KINDS.includes(item)));
  } catch {
    return new Set();
  }
}

function normalizeStatus(value?: string) {
  const status = value?.trim().toLowerCase();
  if (status === "running" || status === "completed") return status;
  return "unknown";
}

function getWorkflowFailureMessage(result: AgentRunResult | null) {
  if (result?.status !== "failed") return null;
  const output = isRecord(result.workflow_output) ? result.workflow_output : null;
  const errors = Array.isArray(output?.errors)
    ? output.errors.filter((error): error is string => typeof error === "string" && Boolean(error.trim()))
    : [];
  if (errors.length) return errors.join("\n");
  if (typeof output?.summary === "string" && output.summary.trim()) return output.summary;
  return "The workflow reported a failed status. Open the trace to inspect the errored spans.";
}

function getSpanId(span: SpanRecord) {
  if (typeof span.span_id === "string") return span.span_id;
  if (typeof span.id === "string") return span.id;
  return undefined;
}

function getParentSpanId(span: SpanRecord) {
  if (typeof span.parent_id === "string") return span.parent_id;
  return undefined;
}

function getSpanData(span: SpanRecord) {
  return isRecord(span.span_data) ? span.span_data : {};
}

function getSpanTitle(span: SpanRecord) {
  const data = getSpanData(span);
  const name = data.name ?? data.tool_name ?? data.agent_name ?? data.type ?? span.name;
  return typeof name === "string" && name ? name : "span";
}

function getSpanKind(span: SpanRecord) {
  const data = getSpanData(span);
  const title = getSpanTitle(span).toLowerCase();
  const type = String(data.type ?? span.type ?? "").toLowerCase();
  if (title.includes("guardrail") || type.includes("guardrail")) return "guardrail";
  if (title.includes("tool") || type.includes("tool") || type.includes("function")) return "tool";
  if (title.includes("agent") || type.includes("agent")) return "agent";
  if (title.includes("response") || type.includes("response")) return "model";
  return "span";
}

function isHiddenWrapperSpan(span: SpanRecord) {
  const data = getSpanData(span);
  const title = getSpanTitle(span).toLowerCase();
  const type = String(data.type ?? span.type ?? "").toLowerCase();
  const sdkSpanType = isRecord(data.data) ? String(data.data.sdk_span_type ?? "").toLowerCase() : "";

  return title === "task" || title === "turn" || sdkSpanType === "task" || sdkSpanType === "turn" || type === "turn";
}

function getSpanDuration(span: SpanRecord) {
  const startValue = span.started_at ?? span.start_time;
  const endValue = span.ended_at ?? span.end_time;
  if (!startValue || !endValue) return undefined;
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(end - start, 0);
}

function getSpanStart(span: SpanRecord) {
  const startValue = span.started_at ?? span.start_time;
  if (!startValue) return undefined;
  const start = Date.parse(startValue);
  return Number.isNaN(start) ? undefined : start;
}

function getSpanEnd(span: SpanRecord) {
  const endValue = span.ended_at ?? span.end_time;
  if (!endValue) return undefined;
  const end = Date.parse(endValue);
  return Number.isNaN(end) ? undefined : end;
}

function getTimelineRange(spans: SpanRecord[]): TimelineRange | null {
  const times = spans.flatMap((span) => [getSpanStart(span), getSpanEnd(span)]).filter((value): value is number => {
    return typeof value === "number";
  });

  if (times.length === 0) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

function getSpanBounds(span: SpanRecord) {
  const start = getSpanStart(span);
  const end = getSpanEnd(span);
  if (typeof start !== "number" && typeof end !== "number") return null;
  const fallback = start ?? end ?? 0;
  return {
    start: start ?? fallback,
    end: end ?? fallback,
  };
}

function spanContainsSpan(parent: SpanRecord, child: SpanRecord) {
  const parentBounds = getSpanBounds(parent);
  const childBounds = getSpanBounds(child);
  if (!parentBounds || !childBounds) return false;
  return parentBounds.start <= childBounds.start && parentBounds.end >= childBounds.end;
}

function spanRange(span: SpanRecord) {
  const bounds = getSpanBounds(span);
  return bounds ? Math.max(bounds.end - bounds.start, 0) : Number.POSITIVE_INFINITY;
}

function getTimelineBarStyle(span: SpanRecord, timelineRange: TimelineRange | null) {
  const start = getSpanStart(span);
  const end = getSpanEnd(span);
  if (!timelineRange || typeof start !== "number" || typeof end !== "number") {
    return { left: "0%", width: "0%" };
  }

  const range = Math.max(timelineRange.end - timelineRange.start, 1);
  const left = Math.max(((start - timelineRange.start) / range) * 100, 0);
  const width = Math.max(((Math.max(end - start, 0)) / range) * 100, 0.8);
  return {
    left: `${Math.min(left, 99.2)}%`,
    width: `${Math.min(width, 100 - left)}%`,
  };
}

function formatDateTime(value?: string | number) {
  if (value === undefined || value === null) return "n/a";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getResponseRecord(span: SpanRecord) {
  return isRecord(span.response) ? span.response : null;
}

function getUsage(span: SpanRecord) {
  const spanData = getSpanData(span);
  const response = getResponseRecord(span);
  const responseUsage = response && isRecord(response.usage) ? response.usage : null;
  const spanUsage = isRecord(spanData.usage) ? spanData.usage : null;
  const usage = responseUsage ?? spanUsage;

  return {
    input: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    output: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
    total: typeof usage?.total_tokens === "number" ? usage.total_tokens : 0,
  };
}

function getGenerationModels(span: SpanRecord) {
  const data = getSpanData(span);
  const response = getResponseRecord(span);
  const modelConfig = isRecord(data.model_config) ? data.model_config : null;
  const configuredModel = typeof data.model === "string" ? data.model : undefined;
  const responseModel = typeof response?.model === "string" ? response.model : undefined;
  const requestedModel = typeof modelConfig?.requested_model === "string"
    ? modelConfig.requested_model
    : configuredModel;
  let model = responseModel ?? configuredModel;
  if (typeof modelConfig?.model === "string") {
    model = modelConfig.model;
  } else if (typeof modelConfig?.actual_model === "string") {
    model = modelConfig.actual_model;
  }

  return {
    model,
    requested: requestedModel,
  };
}

function stringifyForDisplay(value: unknown) {
  if (value === undefined || value === null || value === "") return "No output";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function truncateForSummary(value: unknown, maxLength = 280) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function parseJsonish(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getToolNames(response: Record<string, unknown> | null) {
  const tools = Array.isArray(response?.tools) ? response.tools : [];
  return tools
    .map((tool) => (isRecord(tool) && typeof tool.name === "string" ? tool.name : null))
    .filter((name): name is string => Boolean(name));
}

function getResponseOutput(response: Record<string, unknown> | null) {
  return Array.isArray(response?.output) ? response.output : [];
}

function getOutputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(getOutputText).filter(Boolean).join("\n") || undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.text === "string") return value.text;
  if (typeof value.output_text === "string") return value.output_text;
  if (Array.isArray(value.content)) return getOutputText(value.content);
  return undefined;
}

function getFunctionCallItems(items: unknown[]) {
  return items.filter((item) => isRecord(item) && item.type === "function_call");
}

function getDetailTitle(detail: SelectedDetail | null) {
  if (!detail) return "Trace";
  if (detail.kind === "span") {
    const kind = getSpanKind(detail.value);
    if (kind === "model") return "POST /v1/responses";
    return getSpanTitle(detail.value);
  }
  if (detail.kind === "event" && detail.value.guardrail_name) {
    return detail.value.guardrail_name;
  }
  return detail.kind;
}

function getSpanInput(span: SpanRecord) {
  const data = getSpanData(span);
  return span.input ?? data.input;
}

function getSpanOutput(span: SpanRecord) {
  const data = getSpanData(span);
  return span.output ?? data.output;
}

function hasInspectorValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function getStringField(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

function getNumberField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && /^\d+$/.test(field)) return Number(field);
  return undefined;
}

function fileNameFromPath(sourcePath?: string) {
  if (!sourcePath) return undefined;
  return sourcePath.split(/[\\/]/).filter(Boolean).at(-1);
}

function getAttachmentSourcePath(attachment: TraceAttachment) {
  return getStringField(attachment, ["source_path", "source_pdf_path", "source_file_path", "file_path"]);
}

function getAttachmentFileName(attachment: TraceAttachment) {
  return getStringField(attachment, ["source_file_name", "source_pdf_name"])
    ?? fileNameFromPath(getAttachmentSourcePath(attachment));
}

function getAttachmentPageNumber(attachment: TraceAttachment) {
  return getNumberField(attachment, "page_number");
}

function getAttachmentContentType(attachment: TraceAttachment) {
  const mimeType = typeof attachment.mime_type === "string" && attachment.mime_type.trim()
    ? attachment.mime_type.trim()
    : undefined;
  if (mimeType) return mimeType;
  if (isPdfAttachment(attachment)) return "application/pdf";
  const sourcePath = getAttachmentSourcePath(attachment)?.toLowerCase() ?? "";
  if (sourcePath.endsWith(".png")) return "image/png";
  if (sourcePath.endsWith(".jpg") || sourcePath.endsWith(".jpeg")) return "image/jpeg";
  return typeof attachment.kind === "string" ? attachment.kind : "file";
}

function getAttachmentLabel(attachment: TraceAttachment) {
  const explicitLabel = typeof attachment.label === "string" && attachment.label.trim()
    ? attachment.label.trim()
    : undefined;
  if (explicitLabel) return explicitLabel;

  const fileName = getAttachmentFileName(attachment) ?? "Attachment";
  const pageNumber = getAttachmentPageNumber(attachment);
  return pageNumber ? `${fileName}, page ${pageNumber}` : fileName;
}

function isPdfAttachment(attachment: TraceAttachment) {
  const sourcePath = getAttachmentSourcePath(attachment)?.toLowerCase() ?? "";
  const mimeType = typeof attachment.mime_type === "string" ? attachment.mime_type.toLowerCase() : "";
  return sourcePath.endsWith(".pdf") || mimeType === "application/pdf";
}

function getAttachmentPreviewHref(attachment: TraceAttachment, options?: { page?: number; scale?: number; meta?: boolean }) {
  if (typeof attachment.preview_url === "string" && attachment.preview_url.trim()) {
    return attachment.preview_url.trim();
  }

  const sourcePath = getAttachmentSourcePath(attachment);
  if (!sourcePath) return undefined;

  const pageNumber = options?.page ?? getAttachmentPageNumber(attachment);
  const params = new URLSearchParams({ path: sourcePath });
  if (pageNumber) params.set("page", String(pageNumber));
  if (options?.scale) params.set("scale", String(options.scale));
  if (options?.meta) params.set("meta", "1");

  const href = `/api/attachments/preview?${params.toString()}`;
  return href;
}

function getAttachmentMetaLabel(attachment: TraceAttachment) {
  const pageNumber = getAttachmentPageNumber(attachment);
  const contentType = getAttachmentContentType(attachment);
  return [pageNumber ? `page ${pageNumber}` : undefined, contentType].filter(Boolean).join(" | ");
}

function createAttachmentPreview(attachment: TraceAttachment, attachments?: TraceAttachment[], currentIndex?: number): AttachmentPreview | null {
  const href = getAttachmentPreviewHref(attachment);
  if (!href) return null;

  return {
    attachment,
    attachments,
    currentIndex,
    href,
    label: getAttachmentLabel(attachment),
  };
}

function isImageAttachment(attachment: TraceAttachment) {
  const mimeType = typeof attachment.mime_type === "string" ? attachment.mime_type.toLowerCase() : "";
  const sourcePath = getAttachmentSourcePath(attachment)?.toLowerCase() ?? "";
  if (sourcePath.endsWith(".pdf")) return true;
  return (
    mimeType.startsWith("image/")
    || [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((extension) => sourcePath.endsWith(extension))
  );
}

function attachmentKey(attachment: TraceAttachment, index: number) {
  return [
    typeof attachment.id === "string" ? attachment.id : "",
    getAttachmentSourcePath(attachment) ?? "",
    getAttachmentPageNumber(attachment) ?? "",
    typeof attachment.sha256 === "string" ? attachment.sha256 : "",
    index,
  ].join("|");
}

function normalizeTraceAttachment(value: unknown): TraceAttachment | null {
  if (!isRecord(value)) return null;
  if (!getAttachmentSourcePath(value) && !getAttachmentFileName(value) && typeof value.label !== "string") {
    return null;
  }
  return value as TraceAttachment;
}

function attachmentFromImageMetadata(metadata: Record<string, unknown>): TraceAttachment | null {
  const sourcePath = getStringField(metadata, ["source_path", "source_pdf_path", "source_file_path", "file_path"]);
  const sourceFileName = getStringField(metadata, ["source_file_name", "source_pdf_name"]) ?? fileNameFromPath(sourcePath);
  if (!sourcePath && !sourceFileName) return null;

  const pageNumber = getNumberField(metadata, "page_number");
  const sha256 = getStringField(metadata, ["sha256"]);
  const idSeed = `${sourcePath ?? ""}|${sourceFileName ?? ""}|${pageNumber ?? ""}|${sha256 ?? ""}`;

  return {
    id: `metadata_${idSeed}`,
    kind: getStringField(metadata, ["mime_type"])?.startsWith("image/") ? "image" : "file",
    label: `${sourceFileName ?? sourcePath ?? "Attachment"}${pageNumber ? `, page ${pageNumber}` : ""}`,
    source_path: sourcePath,
    source_file_name: sourceFileName,
    page_number: pageNumber,
    mime_type: getStringField(metadata, ["mime_type"]),
    sha256,
    original_image_chars: getNumberField(metadata, "original_image_chars"),
  };
}

function collectAttachmentsFromValue(value: unknown) {
  const attachments: TraceAttachment[] = [];

  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }

    if (!isRecord(item)) return;

    if (typeof item.image_url === "string" && isRecord(item.metadata)) {
      const attachment = attachmentFromImageMetadata(item.metadata);
      if (attachment) attachments.push(attachment);
    }

    Object.values(item).forEach(visit);
  };

  visit(value);
  return attachments;
}

function uniqueAttachments(attachments: TraceAttachment[]) {
  const seen = new Set<string>();
  return attachments.filter((attachment, index) => {
    const key = attachmentKey(attachment, index).replace(/\|\d+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSpanAttachments(span: SpanRecord) {
  const explicitAttachments = Array.isArray(span.trace_attachments)
    ? span.trace_attachments.map(normalizeTraceAttachment).filter((attachment): attachment is TraceAttachment => Boolean(attachment))
    : [];

  if (explicitAttachments.length) return uniqueAttachments(explicitAttachments);

  return uniqueAttachments([
    ...collectAttachmentsFromValue(span.input),
    ...collectAttachmentsFromValue(span.output),
    ...collectAttachmentsFromValue(span.span_data),
  ]);
}

function getRawSpanForDisplay(span: SpanRecord) {
  const data = getSpanData(span);
  const isFunctionSpan = data.type === "function";
  if (!isFunctionSpan) return span;

  const spanData = { ...data };
  delete spanData.input;
  delete spanData.output;

  const rawSpan = { ...span, span_data: spanData } as Record<string, unknown>;
  delete rawSpan.input;
  delete rawSpan.output;
  return rawSpan;
}

function getEventKind(event: TraceEvent) {
  if (event.type.includes("guardrail")) return "guardrail";
  if (event.type.includes("tool")) return "tool";
  if (event.type.includes("llm")) return "model";
  if (event.type.includes("agent")) return "agent";
  if (event.type.includes("trace")) return "trace";
  if (event.type.includes("span")) return "span";
  return "event";
}

function getGuardrailEventIdentity(event: TraceEvent) {
  return [
    event.timestamp,
    event.type,
    event.guardrail_name,
    event.agent_name,
    event.tool_name,
  ].filter(Boolean).join("|");
}

function guardrailWasTriggered(event: TraceEvent) {
  if (typeof event.triggered === "boolean") return event.triggered;
  if (typeof event.passed === "boolean") return !event.passed;
  return false;
}

function getHighestCategoryScore(outputInfo: Record<string, unknown>) {
  if (!isRecord(outputInfo.category_scores)) return null;

  const scores = Object.entries(outputInfo.category_scores)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort((left, right) => right[1] - left[1]);
  return scores[0] ?? null;
}

function formatModerationScore(score: number) {
  const percentage = score * 100;
  if (percentage >= 1) return `${percentage.toFixed(1)}%`;
  if (percentage >= 0.01) return `${percentage.toFixed(2)}%`;
  return `${percentage.toPrecision(2)}%`;
}

function getGuardrailEventSummary(event: TraceEvent) {
  if (!isRecord(event.output_info)) return "No structured output was recorded.";
  const outputInfo = event.output_info;

  if (typeof outputInfo.reason === "string" && outputInfo.reason.trim()) {
    return outputInfo.reason.trim();
  }

  const flaggedCategories = Array.isArray(outputInfo.flagged_categories)
    ? outputInfo.flagged_categories.filter((category): category is string => typeof category === "string")
    : [];
  if (flaggedCategories.length) {
    return `Flagged categories: ${flaggedCategories.join(", ")}`;
  }

  if (typeof outputInfo.moderation_flagged === "boolean") {
    const highestScore = getHighestCategoryScore(outputInfo);
    if (outputInfo.moderation_flagged) return "Moderation flagged this content.";
    if (highestScore) {
      return `No categories flagged · highest score ${highestScore[0]} ${formatModerationScore(highestScore[1])}`;
    }
    return "No moderation categories flagged.";
  }

  if (typeof outputInfo.blocked_keyword === "string" && outputInfo.blocked_keyword) {
    return `Blocked keyword: ${outputInfo.blocked_keyword}`;
  }
  if (typeof outputInfo.blocked_operation === "string" && outputInfo.blocked_operation) {
    return `Blocked protected operation: ${outputInfo.blocked_operation}`;
  }
  if (event.guardrail_name === "sql_read_only_guardrail" && outputInfo.allowed === true) {
    return "SQL query is read-only.";
  }
  if (event.guardrail_name === "sql_write_guardrail" && outputInfo.allowed === true) {
    return "SQL write does not create or delete a protected entity.";
  }
  if (typeof outputInfo.allowed === "boolean") {
    return outputInfo.allowed ? "Guardrail allowed this operation." : "Guardrail rejected this operation.";
  }
  return "Structured output available in the inspector.";
}

function correlateGuardrailEventsToSpans(spans: SpanRecord[], events: TraceEvent[]) {
  const eventsByName = new Map<string, TraceEvent[]>();
  for (const event of events) {
    if (!event.guardrail_name) continue;
    const matches = eventsByName.get(event.guardrail_name) ?? [];
    matches.push(event);
    eventsByName.set(event.guardrail_name, matches);
  }
  for (const matches of eventsByName.values()) {
    matches.sort((left, right) => {
      const leftTime = Date.parse(left.timestamp ?? "");
      const rightTime = Date.parse(right.timestamp ?? "");
      return (Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime)
        - (Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime);
    });
  }

  const nextEventIndex = new Map<string, number>();
  const eventBySpanId = new Map<string, TraceEvent>();
  const guardrailSpans = spans
    .filter((span) => getSpanKind(span) === "guardrail")
    .sort((left, right) => (
      (getSpanStart(left) ?? Number.POSITIVE_INFINITY)
      - (getSpanStart(right) ?? Number.POSITIVE_INFINITY)
    ));

  for (const span of guardrailSpans) {
    const spanId = getSpanId(span);
    const guardrailName = getSpanTitle(span);
    if (!spanId) continue;
    const eventIndex = nextEventIndex.get(guardrailName) ?? 0;
    const event = eventsByName.get(guardrailName)?.[eventIndex];
    if (!event) continue;
    eventBySpanId.set(spanId, event);
    nextEventIndex.set(guardrailName, eventIndex + 1);
  }

  return eventBySpanId;
}

function getEventTitle(event: TraceEvent) {
  if (event.agent_name && event.tool_name) return `${event.type}: ${event.agent_name} -> ${event.tool_name}`;
  if (event.agent_name) return `${event.type}: ${event.agent_name}`;
  if (event.tool_name) return `${event.type}: ${event.tool_name}`;
  if (event.guardrail_name) return `${event.type}: ${event.guardrail_name}`;
  if (event.type === "span_end" && event.span) return `span_end: ${getSpanTitle(event.span)}`;
  return event.type;
}

function getRunEventTitle(event: TraceEvent) {
  if (event.type === "trace_start") return "Trace started";
  if (event.type === "trace_end") return "Trace completed";
  if (event.type === "agent_start") return `Agent started: ${event.agent_name ?? "unknown"}`;
  if (event.type === "agent_end") return `Agent finished: ${event.agent_name ?? "unknown"}`;
  if (event.type === "llm_end") return `Model response: ${event.agent_name ?? "unknown"}`;
  if (event.type === "tool_start") return `Tool started: ${event.tool_name ?? "unknown"}`;
  if (event.type === "tool_end") return `Tool finished: ${event.tool_name ?? "unknown"}`;
  if (event.type === "handoff") return "Agent handoff";
  return getEventTitle(event);
}

function getRunEventMeta(event: TraceEvent) {
  const parts = [formatTime(event.timestamp)];
  if (event.agent_name && !getRunEventTitle(event).includes(event.agent_name)) {
    parts.push(event.agent_name);
  }
  if (event.tool_name && !getRunEventTitle(event).includes(event.tool_name)) {
    parts.push(event.tool_name);
  }
  if (event.guardrail_name) parts.push(event.guardrail_name);

  const model = typeof event.model === "string" ? event.model : undefined;
  const requestedModel = typeof event.requested_model === "string" ? event.requested_model : undefined;
  if (model) parts.push(requestedModel && requestedModel !== model ? `${model} from ${requestedModel}` : model);

  const inputTokens = typeof event.input_tokens === "number" ? event.input_tokens : 0;
  const outputTokens = typeof event.output_tokens === "number" ? event.output_tokens : 0;
  if (inputTokens || outputTokens) {
    parts.push(`${formatNumber(inputTokens)} in / ${formatNumber(outputTokens)} out`);
  }

  return parts.filter(Boolean).join(" · ");
}

function getRunEvents(trace: TraceRecord | null) {
  const events = trace?.events ?? [];
  return events.filter((event) => {
    if (event.type === "heartbeat" || event.type === "connected") return false;
    if (event.type === "trace_start" || event.type === "trace_end") return true;
    return event.source === "run_hooks";
  });
}

function buildSpanTree(spans: SpanRecord[]) {
  const nodes = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];
  const spanOrder = new Map<string, number>();

  for (const [index, span] of spans.entries()) {
    const spanId = getSpanId(span);
    if (!spanId) continue;
    spanOrder.set(spanId, index);
    nodes.set(spanId, { span, children: [] });
  }

  const hasAncestor = (node: SpanNode, ancestorId: string) => {
    let parentId = getParentSpanId(node.span);
    while (parentId) {
      if (parentId === ancestorId) return true;
      const parentNode = nodes.get(parentId);
      parentId = parentNode ? getParentSpanId(parentNode.span) : undefined;
    }
    return false;
  };

  const compareNodes = (left: SpanNode, right: SpanNode) => {
    const leftStart = getSpanStart(left.span) ?? Number.POSITIVE_INFINITY;
    const rightStart = getSpanStart(right.span) ?? Number.POSITIVE_INFINITY;
    if (leftStart !== rightStart) return leftStart - rightStart;

    const leftEnd = getSpanEnd(left.span) ?? Number.POSITIVE_INFINITY;
    const rightEnd = getSpanEnd(right.span) ?? Number.POSITIVE_INFINITY;
    if (leftEnd !== rightEnd) return leftEnd - rightEnd;

    const leftId = getSpanId(left.span) ?? "";
    const rightId = getSpanId(right.span) ?? "";
    const leftOrder = spanOrder.get(leftId) ?? Number.POSITIVE_INFINITY;
    const rightOrder = spanOrder.get(rightId) ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const leftTitle = getSpanTitle(left.span);
    const rightTitle = getSpanTitle(right.span);
    if (leftTitle < rightTitle) return -1;
    if (leftTitle > rightTitle) return 1;
    return 0;
  };

  const findEnclosingParent = (node: SpanNode) => {
    const nodeId = getSpanId(node.span);
    if (!nodeId || !getParentSpanId(node.span)) return undefined;

    return [...nodes.values()]
      .filter((candidate) => {
        const candidateId = getSpanId(candidate.span);
        return Boolean(candidateId)
          && candidateId !== nodeId
          && !hasAncestor(candidate, nodeId)
          && spanContainsSpan(candidate.span, node.span);
      })
      .sort((left, right) => {
        const leftVisibleRank = isHiddenWrapperSpan(left.span) ? 1 : 0;
        const rightVisibleRank = isHiddenWrapperSpan(right.span) ? 1 : 0;
        if (leftVisibleRank !== rightVisibleRank) return leftVisibleRank - rightVisibleRank;

        const durationDelta = spanRange(left.span) - spanRange(right.span);
        if (durationDelta !== 0) return durationDelta;

        return compareNodes(left, right);
      })[0];
  };

  for (const node of nodes.values()) {
    const parentId = getParentSpanId(node.span);
    const parent = parentId ? nodes.get(parentId) : undefined;
    const inferredParent = parent ?? findEnclosingParent(node);
    if (inferredParent) inferredParent.children.push(node);
    else roots.push(node);
  }

  const sortTree = (items: SpanNode[]): SpanNode[] => (
    [...items]
      .sort(compareNodes)
      .map((node) => ({ ...node, children: sortTree(node.children) }))
  );

  const removeHiddenWrappers = (node: SpanNode): SpanNode[] => {
    const children = node.children.flatMap(removeHiddenWrappers);
    if (isHiddenWrapperSpan(node.span)) return children;
    return [{ ...node, children }];
  };

  return sortTree(sortTree(roots).flatMap(removeHiddenWrappers));
}

function flattenSpanNodes(nodes: SpanNode[]): SpanRecord[] {
  return nodes.flatMap((node) => [node.span, ...flattenSpanNodes(node.children)]);
}

function getTopRelativeSpanIds(spans: SpanRecord[], getValue: (span: SpanRecord) => number) {
  const ranked = spans
    .map((span) => ({ spanId: getSpanId(span), value: getValue(span) }))
    .filter((item): item is { spanId: string; value: number } => Boolean(item.spanId) && item.value > 0)
    .sort((left, right) => right.value - left.value);
  const limit = Math.min(ranked.length, Math.max(3, Math.ceil(ranked.length * 0.2)));
  return new Set(ranked.slice(0, limit).map((item) => item.spanId));
}

function spanHasTriggeredGuardrail(span: SpanRecord) {
  const data = getSpanData(span);
  return data.triggered === true || Boolean(span.error);
}

function spanSearchText(span: SpanRecord) {
  const data = getSpanData(span);
  return [
    getSpanTitle(span),
    getSpanKind(span),
    getSpanId(span),
    data.name,
    data.tool_name,
    data.agent_name,
    data.type,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function spanMatchesFilters(span: SpanRecord, filters: SpanFilters, relativeSets: RelativeSpanFilterSets) {
  const search = filters.search.trim().toLowerCase();
  const spanId = getSpanId(span);

  if (search && !spanSearchText(span).includes(search)) return false;
  if (filters.kind !== "all" && getSpanKind(span) !== filters.kind) return false;
  if (filters.quickFilter === "files" && getSpanAttachments(span).length === 0) return false;
  if (filters.quickFilter === "slow" && (!spanId || !relativeSets.slowSpanIds.has(spanId))) return false;
  if (filters.quickFilter === "cost" && (!spanId || !relativeSets.costlySpanIds.has(spanId))) return false;
  if (filters.quickFilter === "triggered" && !spanHasTriggeredGuardrail(span)) return false;
  return true;
}

function filterSpanTree(nodes: SpanNode[], filters: SpanFilters, relativeSets: RelativeSpanFilterSets): SpanNode[] {
  return nodes.flatMap((node) => {
    const children = filterSpanTree(node.children, filters, relativeSets);
    if (spanMatchesFilters(node.span, filters, relativeSets) || children.length) {
      return [{ ...node, children }];
    }
    return [];
  });
}

function getCollapsibleSpanIds(nodes: SpanNode[], predicate?: (node: SpanNode) => boolean): string[] {
  return nodes.flatMap((node) => {
    const spanId = getSpanId(node.span);
    const current = spanId && node.children.length && (!predicate || predicate(node)) ? [spanId] : [];
    return [...current, ...getCollapsibleSpanIds(node.children, predicate)];
  });
}

export function Dashboard() {
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceRecord | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [runtimeDataRevision, setRuntimeDataRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set());
  const [collapsedSpanTypes, setCollapsedSpanTypes] = useState<Set<CollapsedSpanKind>>(() => new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<DashboardView>("runs");
  const [traceSidebarQuery, setTraceSidebarQuery] = useState("");
  const [traceSidebarStatus, setTraceSidebarStatus] = useState<TraceStatusFilter>("all");
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(DEFAULT_PANE_LAYOUT);
  const [spanFilters, setSpanFilters] = useState<SpanFilters>(DEFAULT_SPAN_FILTERS);
  const [selectedBatchTraceIds, setSelectedBatchTraceIds] = useState<Set<string>>(() => new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [traceManagementMode, setTraceManagementMode] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [activeRunTraceId, setActiveRunTraceId] = useState<string | null>(null);
  const [workflowResult, setWorkflowResult] = useState<AgentRunResult | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [liveRunContext, setLiveRunContext] = useState<RunContext | null>(null);
  const [runContextLookup, setRunContextLookup] = useState<RunContextLookup | null>(null);
  const [runStateHydrated, setRunStateHydrated] = useState(false);
  const [runContextResetting, setRunContextResetting] = useState(false);
  const [inspectedTicketContext, setInspectedTicketContext] = useState<RunContext | null>(null);
  const [ticketContextError, setTicketContextError] = useState<string | null>(null);
  const [selectedEvalTraceIds, setSelectedEvalTraceIds] = useState<Set<string>>(() => new Set());
  const [judgeModel, setJudgeModel] = useState("openai/gpt-6.1-sol");
  const [judgeModels, setJudgeModels] = useState<string[]>([
    "openai/gpt-6-luna",
    "openai/gpt-6.1-sol",
    "openai/gpt-6.1-terra",
    "openai/gpt-6-sol",
    "openai/gpt-5.6",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.5",
    "openai/gpt-5.5-pro",
    "openai/gpt-5.4",
    "openai/gpt-5.4-pro",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4-nano",
  ]);
  const [judgeBackendProvider, setJudgeBackendProvider] = useState<JudgeBackendProvider>("unavailable");
  const [judgeBackendUsingFallback, setJudgeBackendUsingFallback] = useState(false);
  const [judgeApiKeySource, setJudgeApiKeySource] = useState<JudgeApiKeySource | null>(null);
  const [judgeModelsError, setJudgeModelsError] = useState<string | null>(null);
  const [judgePrompt, setJudgePrompt] = useState("");
  const [defaultJudgePrompt, setDefaultJudgePrompt] = useState("");
  const [savedJudgePrompt, setSavedJudgePrompt] = useState("");
  const [judgePromptPath, setJudgePromptPath] = useState("");
  const [judgePromptError, setJudgePromptError] = useState<string | null>(null);
  const [judgePromptSaving, setJudgePromptSaving] = useState(false);
  const [judgePromptSaveMessage, setJudgePromptSaveMessage] = useState<string | null>(null);
  const [evalContextDocuments, setEvalContextDocuments] = useState<EvalContextDocument[]>([]);
  const [evalContextPath, setEvalContextPath] = useState("");
  const [evalContextChars, setEvalContextChars] = useState(0);
  const [evalContextError, setEvalContextError] = useState<string | null>(null);
  const [evalContextAdding, setEvalContextAdding] = useState(false);
  const [evalContextClearing, setEvalContextClearing] = useState(false);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResults, setEvalResults] = useState<EvalRunResult[]>([]);
  const [evalCompletedCount, setEvalCompletedCount] = useState(0);
  const [evalStateHydrated, setEvalStateHydrated] = useState(false);
  const [expandedEvalTraceIds, setExpandedEvalTraceIds] = useState<Set<string>>(() => new Set());
  const [promptImprovementRunning, setPromptImprovementRunning] = useState(false);
  const [promptImprovement, setPromptImprovement] = useState<PromptImprovementResult | null>(null);
  const [promptImprovementError, setPromptImprovementError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const runTraceSelectionPendingRef = useRef(false);
  const selectedTraceIdRef = useRef<string | null>(null);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(LOCAL_STORAGE_KEYS.theme);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
    setActiveView(parseStoredView(window.localStorage.getItem(LOCAL_STORAGE_KEYS.activeView)));
    setPaneLayout(parseStoredPaneLayout(window.localStorage.getItem(LOCAL_STORAGE_KEYS.paneLayout)));
    setCollapsedSpanTypes(parseStoredCollapsedSpanTypes(window.localStorage.getItem(LOCAL_STORAGE_KEYS.collapsedSpanTypes)));
    setPreferencesHydrated(true);
  }, []);

  useEffect(() => {
    const storedRun = window.localStorage.getItem(LOCAL_STORAGE_KEYS.currentRun);
    if (!storedRun) {
      setRunStateHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedRun) as unknown;
      if (!isRecord(parsed) || (parsed.version !== 2 && parsed.version !== 3)) return;

      setSelectedScenarioId(getRecordString(parsed, "selected_scenario_id"));
      setWorkflowResult(
        isRecord(parsed.workflow_result)
          ? parsed.workflow_result as unknown as AgentRunResult
          : null,
      );
      setWorkflowError(
        typeof parsed.workflow_error === "string" ? parsed.workflow_error : null,
      );
      setLiveRunContext(
        normalizeRunContext(parsed.live_context),
      );
      setRunContextLookup(
        isRecord(parsed.context_lookup) && typeof parsed.context_lookup.ticket_id === "string"
          ? { ticket_id: parsed.context_lookup.ticket_id } : null,
      );
    } catch {
      // Ignore malformed local state and retain the default run configuration.
    } finally {
      setRunStateHydrated(true);
    }
  }, []);

  useEffect(() => {
    const storedEval = window.localStorage.getItem(LOCAL_STORAGE_KEYS.latestEval);
    if (!storedEval) {
      setEvalStateHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedEval) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.results)) return;

      const results = parsed.results.filter(
        (result): result is EvalRunResult => isRecord(result) && typeof result.trace_id === "string",
      );
      setEvalResults(results);
      setEvalCompletedCount(results.length);
      setSelectedEvalTraceIds(new Set(results.map((result) => result.trace_id)));
    } catch {
      // Ignore malformed local state and retain the empty eval result list.
    } finally {
      setEvalStateHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesHydrated) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.theme, theme);
  }, [theme, preferencesHydrated]);

  useEffect(() => {
    if (!runStateHydrated) return;

    const persistedRun: PersistedRunState = {
      version: 3,
      selected_scenario_id: selectedScenarioId,
      workflow_result: workflowResult,
      workflow_error: workflowError,
      live_context: liveRunContext,
      context_lookup: runContextLookup,
    };
    window.localStorage.setItem(
      LOCAL_STORAGE_KEYS.currentRun,
      JSON.stringify(persistedRun),
    );
  }, [
    liveRunContext,
    runContextLookup,
    runStateHydrated,
    selectedScenarioId,
    workflowError,
    workflowResult,
  ]);

  useEffect(() => {
    if (!evalStateHydrated) return;
    if (evalResults.length === 0) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEYS.latestEval);
      return;
    }

    const persistedEval: PersistedEvalState = {
      version: 1,
      results: evalResults,
    };
    window.localStorage.setItem(
      LOCAL_STORAGE_KEYS.latestEval,
      JSON.stringify(persistedEval),
    );
  }, [evalResults, evalStateHydrated]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.activeView, activeView);
  }, [activeView, preferencesHydrated]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [activeView]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.paneLayout, JSON.stringify(paneLayout));
  }, [paneLayout, preferencesHydrated]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.collapsedSpanTypes, JSON.stringify([...collapsedSpanTypes]));
  }, [collapsedSpanTypes, preferencesHydrated]);

  const loadSummaries = useCallback(async () => {
    const data = await fetchJson<{ traces: TraceSummary[] }>("/api/traces");
    setSummaries(data.traces);
    setSummariesLoaded(true);
    setSelectedTraceId((current) => current ?? data.traces[0]?.trace_id ?? null);
  }, []);

  const loadEvalContext = useCallback(async () => {
    const data = await fetchJson<EvalContextResponse>("/api/evals/context");
    setEvalContextDocuments(data.documents);
    setEvalContextPath(data.context_path);
    setEvalContextChars(data.context_chars);
    setEvalContextError(data.error ?? null);
  }, []);

  const loadTrace = useCallback(async (traceId: string) => {
    const data = await fetchJson<TraceRecord>(`/api/traces/${encodeURIComponent(traceId)}`);
    setTrace(data);
    setSelectedDetail((current) => current ?? { kind: "trace", value: data });
  }, []);

  const refreshCompletedRun = useCallback((traceId: string) => {
    void Promise.all([loadSummaries(), loadTrace(traceId)]).catch((loadError: Error) => {
      setError(loadError.message);
    });
  }, [loadSummaries, loadTrace]);

  const deleteTraces = useCallback(
    async (traceIds: string[]) => {
      const uniqueTraceIds = [...new Set(traceIds)];
      if (uniqueTraceIds.length === 0 || batchDeleting) return;
      const traceLabel = (traceId: string) => {
        const summary = summaries.find((item) => item.trace_id === traceId);
        return summary ? getTraceDisplayName(summary) : traceId;
      };

      const confirmed = window.confirm(
        uniqueTraceIds.length === 1
          ? `Delete trace ${traceLabel(uniqueTraceIds[0])}? This removes the local dashboard record and matching traces_logs file.`
          : `Delete ${uniqueTraceIds.length} traces? This removes local dashboard records and matching traces_logs files.`,
      );
      if (!confirmed) return;

      setBatchDeleting(true);
      try {
        const responses = await Promise.all(
          uniqueTraceIds.map(async (traceId) => {
            const response = await fetch(`/api/traces/${encodeURIComponent(traceId)}`, {
              method: "DELETE",
            });
            return { traceId, response };
          }),
        );
        const failed = responses.filter(({ response }) => !response.ok);
        if (failed.length) {
          throw new Error(`Delete failed for ${failed.length} trace${failed.length === 1 ? "" : "s"}.`);
        }

        const deletedIds = new Set(uniqueTraceIds);
        const nextSummaries = summaries.filter((summary) => !deletedIds.has(summary.trace_id));
        setSummaries(nextSummaries);
        setSelectedBatchTraceIds((current) => {
          const next = new Set(current);
          for (const traceId of deletedIds) next.delete(traceId);
          return next;
        });
        if (selectedTraceId && deletedIds.has(selectedTraceId)) {
          const nextTraceId = nextSummaries[0]?.trace_id ?? null;
          setSelectedTraceId(nextTraceId);
          setTrace(null);
          setSelectedDetail(null);
        }
        await loadSummaries();
      } finally {
        setBatchDeleting(false);
      }
    },
    [batchDeleting, loadSummaries, selectedTraceId, summaries],
  );

  useEffect(() => {
    loadSummaries().catch((loadError: Error) => setError(loadError.message));
  }, [loadSummaries]);

  useEffect(() => {
    if (!evalStateHydrated || !summariesLoaded) return;

    const availableTraceIds = new Set(summaries.map((summary) => summary.trace_id));
    const validResults = evalResults.filter((result) => availableTraceIds.has(result.trace_id));
    if (validResults.length !== evalResults.length) {
      setEvalResults(validResults);
      setEvalCompletedCount(validResults.length);
    }

    const retainAvailableTraceIds = (current: Set<string>) => {
      const next = new Set([...current].filter((traceId) => availableTraceIds.has(traceId)));
      return next.size === current.size ? current : next;
    };
    setSelectedEvalTraceIds(retainAvailableTraceIds);
    setExpandedEvalTraceIds(retainAvailableTraceIds);
  }, [evalResults, evalStateHydrated, summaries, summariesLoaded]);

  useEffect(() => {
    loadEvalContext().catch((contextError: Error) => setEvalContextError(contextError.message));
  }, [loadEvalContext]);

  useEffect(() => {
    fetchJson<JudgePromptResponse>("/api/evals/judge-prompt")
      .then((data) => {
        setJudgePrompt(data.prompt);
        setSavedJudgePrompt(data.prompt);
        setDefaultJudgePrompt(data.default_prompt);
        setJudgePromptPath(data.prompt_path);
        setJudgePromptError(data.error ?? null);
        setJudgePromptSaveMessage(null);
      })
      .catch((promptError: Error) => setJudgePromptError(promptError.message));
  }, []);

  useEffect(() => {
    fetchJson<JudgeModelsResponse>("/api/openai/models")
      .then((data) => {
        setJudgeBackendProvider(data.provider);
        setJudgeBackendUsingFallback(data.using_fallback);
        setJudgeApiKeySource(data.judge_api_key_source ?? null);
        setJudgeModels(data.models);
        if (!data.models.includes(judgeModel)) setJudgeModel(data.models[0] ?? "");
        setJudgeModelsError(data.error ?? null);
      })
      .catch((modelError: Error) => {
        setJudgeBackendProvider("unavailable");
        setJudgeBackendUsingFallback(false);
        setJudgeApiKeySource(null);
        setJudgeModelsError(modelError.message);
      });
  }, [judgeModel]);

  useEffect(() => {
    fetchJson<{ scenarios: ScenarioOption[]; error?: string }>("/api/scenarios")
      .then((data) => {
        setScenarios(data.scenarios);
        setSelectedScenarioId((current) => current || data.scenarios[0]?.id || "");
        setScenariosError(data.error ?? null);
      })
      .catch((scenarioError: Error) => setScenariosError(scenarioError.message));
  }, []);

  useEffect(() => {
    if (activeView !== "runs" || !workflowRunning || !runContextLookup?.ticket_id) return;

    let cancelled = false;
    const loadRunContext = async () => {
      const query = new URLSearchParams();
      for (const [field, value] of Object.entries(runContextLookup)) {
        if (value) query.set(field, value);
      }

      try {
        const context = await fetchJson<RunContext>(`/api/runs/context?${query.toString()}`);
        if (cancelled) return;
        setLiveRunContext(context);
        setTicketContextError(null);
      } catch (error) {
        if (!cancelled) setTicketContextError(error instanceof Error ? error.message : String(error));
      }
    };

    void loadRunContext();
    const pollTimer = window.setInterval(() => {
      void loadRunContext();
    }, 750);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [activeView, runContextLookup, workflowRunning]);

  useEffect(() => {
    if (!selectedTraceId) return;
    loadTrace(selectedTraceId).catch((loadError: Error) => setError(loadError.message));
  }, [loadTrace, selectedTraceId]);

  useEffect(() => {
    selectedTraceIdRef.current = selectedTraceId;
  }, [selectedTraceId]);

  useEffect(() => {
    const availableTraceIds = new Set(summaries.map((summary) => summary.trace_id));
    setSelectedBatchTraceIds((current) => {
      const next = new Set([...current].filter((traceId) => availableTraceIds.has(traceId)));
      return next.size === current.size ? current : next;
    });
  }, [summaries]);

  useEffect(() => {
    const eventSource = new EventSource("/api/events/stream");

    eventSource.addEventListener("trace-event", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as TraceEvent;
      setConnected(true);
      if (event.type === "heartbeat" || event.type === "connected") return;

      if (["tool_end", "agent_end", "span_end", "trace_end"].includes(event.type)) {
        setRuntimeDataRevision((current) => current + 1);
      }
      if (event.type === "trace_start" && event.trace_id && runTraceSelectionPendingRef.current) {
        runTraceSelectionPendingRef.current = false;
        setActiveRunTraceId(event.trace_id);
        selectedTraceIdRef.current = event.trace_id;
        setSelectedTraceId(event.trace_id);
        setSelectedDetail(null);
      }
      if (!selectedTraceIdRef.current && event.trace_id) {
        selectedTraceIdRef.current = event.trace_id;
        setSelectedTraceId(event.trace_id);
      }
      if (event.trace_id && event.trace_id === selectedTraceIdRef.current) {
        loadTrace(event.trace_id).catch((loadError: Error) => setError(loadError.message));
      }
      loadSummaries().catch((loadError: Error) => setError(loadError.message));
    });

    eventSource.onerror = () => setConnected(false);
    eventSource.onopen = () => setConnected(true);

    return () => eventSource.close();
  }, [loadSummaries, loadTrace]);

  const selectedSummary = summaries.find((item) => item.trace_id === selectedTraceId) ?? null;
  const selectedTraceDisplay = trace?.trace_id === selectedTraceId
    ? { trace_id: trace.trace_id, workflow_name: trace.workflow_name ?? selectedSummary?.workflow_name }
    : selectedSummary;
  const storedSelectedRunSnapshot = trace?.trace_id === selectedTraceId
    ? parseRunSnapshot(trace.run_snapshot)
    : null;
  const isActiveRunSelected = workflowRunning && (
    !selectedTraceId
    || !activeRunTraceId
    || selectedTraceId === activeRunTraceId
  );
  const isLatestRunSelected = Boolean(
    workflowResult?.trace_id && workflowResult.trace_id === selectedTraceId,
  );
  const useLiveRunState = isActiveRunSelected || isLatestRunSelected;
  const selectedRunSnapshot = storedSelectedRunSnapshot ?? (
    !useLiveRunState && trace?.trace_id === selectedTraceId && trace.status === "completed"
      ? buildTraceRunFallback(trace)
      : null
  );
  const displayedRunResult = selectedRunSnapshot?.result ?? (useLiveRunState ? workflowResult : null);
  const snapshotContext = selectedRunSnapshot?.context ?? null;
  const selectedScenarioTicketId = getRecordString(
    scenarios.find((scenario) => scenario.id === selectedScenarioId)?.payloads[0] ?? {}, "ticket_id",
  );
  const recordedContext = useLiveRunState ? liveRunContext : snapshotContext;
  const referencedTicketId = recordedContext?.ticket_id
    ?? (useLiveRunState ? workflowResult?.ticket_id : !selectedTraceId ? selectedScenarioTicketId : null);
  const lookupTicketId = recordedContext?.ticket || (useLiveRunState && workflowRunning)
    ? null : referencedTicketId;
  const currentInspectedContext = inspectedTicketContext?.ticket_id === lookupTicketId ? inspectedTicketContext : null;
  const displayedRunContext = recordedContext?.ticket ? recordedContext
    : currentInspectedContext ?? recordedContext
      ?? (lookupTicketId ? { ticket_id: lookupTicketId, ticket: null, conversation: [] } : null);

  useEffect(() => {
    setTicketContextError(null);
    if (activeView !== "runs" || !lookupTicketId) return;
    let cancelled = false;
    fetchJson<RunContext>(`/api/runs/context?ticket_id=${encodeURIComponent(lookupTicketId)}`)
      .then((context) => { if (!cancelled) setInspectedTicketContext(context); })
      .catch((error: Error) => { if (!cancelled) setTicketContextError(error.message); });
    return () => { cancelled = true; };
  }, [activeView, lookupTicketId, selectedTraceId, runtimeDataRevision]);
  const displayedRunError = useLiveRunState ? workflowError : null;
  const viewingHistoricalRun = Boolean(
    selectedTraceId && !isActiveRunSelected && !isLatestRunSelected,
  );
  const visibleSidebarSummaries = useMemo(() => {
    const query = traceSidebarQuery.trim().toLowerCase();
    return summaries.filter((summary) => {
      const status = normalizeStatus(summary.status);
      if (traceSidebarStatus === "errors" && summary.error_count === 0) return false;
      if (
        traceSidebarStatus !== "all"
        && traceSidebarStatus !== "errors"
        && status !== traceSidebarStatus
      ) return false;
      if (!query) return true;
      const searchText = [
        getTraceDisplayName(summary),
        summary.trace_id,
        summary.workflow_name,
        status,
        `${summary.event_count} events`,
        `${summary.span_count} spans`,
        `${summary.error_count} errors`,
        formatCost(summary.total_cost),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchText.includes(query);
    });
  }, [summaries, traceSidebarQuery, traceSidebarStatus]);
  const visibleSidebarTraceIds = useMemo(
    () => visibleSidebarSummaries.map((summary) => summary.trace_id),
    [visibleSidebarSummaries],
  );
  const allVisibleBatchSelected = visibleSidebarTraceIds.length > 0
    && visibleSidebarTraceIds.every((traceId) => selectedBatchTraceIds.has(traceId));
  const spanTree = useMemo(() => buildSpanTree(trace?.spans ?? []), [trace?.spans]);
  const allSpanRecords = useMemo(() => flattenSpanNodes(spanTree), [spanTree]);
  const relativeSpanFilterSets = useMemo<RelativeSpanFilterSets>(() => {
    return {
      slowSpanIds: getTopRelativeSpanIds(allSpanRecords, (span) => getSpanDuration(span) ?? 0),
      costlySpanIds: getTopRelativeSpanIds(allSpanRecords, (span) => getUsage(span).total),
    };
  }, [allSpanRecords]);
  const filteredSpanTree = useMemo(() => {
    return filterSpanTree(spanTree, spanFilters, relativeSpanFilterSets);
  }, [relativeSpanFilterSets, spanFilters, spanTree]);
  const visibleSpans = useMemo(() => flattenSpanNodes(filteredSpanTree), [filteredSpanTree]);
  const timelineRange = useMemo(() => getTimelineRange(trace?.spans ?? []), [trace?.spans]);
  const guardrailEvents = useMemo(
    () => trace?.events.filter((event) => (
      !["heartbeat", "connected"].includes(event.type)
      && (event.type.includes("guardrail") || Boolean(event.guardrail_name))
    )) ?? [],
    [trace?.events],
  );
  const guardrailEventBySpanId = useMemo(
    () => correlateGuardrailEventsToSpans(trace?.spans ?? [], guardrailEvents),
    [guardrailEvents, trace?.spans],
  );
  const activeSpanFilterCount = [
    spanFilters.search.trim(),
    spanFilters.kind !== "all",
    spanFilters.quickFilter !== "all",
  ].filter(Boolean).length;
  const judgePromptDirty = judgePrompt !== savedJudgePrompt;
  const judgePromptDefaultDraft = Boolean(defaultJudgePrompt) && judgePrompt === defaultJudgePrompt && judgePromptDirty;

  const toggleNode = useCallback((spanId: string) => {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  const expandAllSpans = useCallback(() => {
    setCollapsedNodes(new Set());
    setCollapsedSpanTypes(new Set());
  }, []);

  useEffect(() => {
    if (collapsedSpanTypes.size === 0) return;
    setCollapsedNodes((current) => {
      const next = new Set(current);
      for (const kind of collapsedSpanTypes) {
        for (const spanId of getCollapsibleSpanIds(spanTree, (node) => getSpanKind(node.span) === kind)) {
          next.add(spanId);
        }
      }
      return next;
    });
  }, [collapsedSpanTypes, spanTree]);

  const collapseAllSpans = useCallback(() => {
    setCollapsedNodes(new Set(getCollapsibleSpanIds(spanTree)));
    setCollapsedSpanTypes(new Set(COLLAPSIBLE_SPAN_KINDS));
  }, [spanTree]);

  const updateSpanFilters = useCallback((updates: Partial<SpanFilters>) => {
    setSpanFilters((current) => ({ ...current, ...updates }));
  }, []);

  const startPaneResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneLayout.inspectorWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setPaneLayout({ inspectorWidth: Math.min(Math.max(startWidth + delta, 300), 720) });
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [paneLayout.inspectorWidth]);

  const toggleEvalTrace = useCallback((traceId: string) => {
    setSelectedEvalTraceIds((current) => {
      const next = new Set(current);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }, []);

  const toggleBatchTrace = useCallback((traceId: string) => {
    setSelectedBatchTraceIds((current) => {
      const next = new Set(current);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }, []);

  const runEvals = useCallback(async () => {
    setEvalRunning(true);
    window.localStorage.removeItem(LOCAL_STORAGE_KEYS.latestEval);
    setEvalResults([]);
    setEvalCompletedCount(0);
    setExpandedEvalTraceIds(new Set());
    setPromptImprovement(null);
    setPromptImprovementError(null);
    setError(null);
    try {
      const response = await fetch("/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trace_ids: [...selectedEvalTraceIds],
          judge_model: judgeModel,
          judge_prompt: judgePrompt,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Eval run failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        const message = JSON.parse(line) as EvalStreamMessage;
        if (message.type === "result") {
          setEvalResults((current) => [...current, message.result]);
          setEvalCompletedCount((current) => current + 1);
        }
        if (message.type === "error") {
          setError(message.error);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }

      buffer += decoder.decode();
      processLine(buffer);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setEvalRunning(false);
    }
  }, [judgeModel, judgePrompt, selectedEvalTraceIds]);

  const clearEvalResults = useCallback(() => {
    const availableTraceIds = new Set(summaries.map((summary) => summary.trace_id));
    window.localStorage.removeItem(LOCAL_STORAGE_KEYS.latestEval);
    setEvalResults([]);
    setEvalCompletedCount(0);
    setExpandedEvalTraceIds(new Set());
    setSelectedEvalTraceIds((current) => (
      new Set([...current].filter((traceId) => availableTraceIds.has(traceId)))
    ));
    setPromptImprovement(null);
    setPromptImprovementError(null);
  }, [summaries]);

  const saveJudgePrompt = useCallback(async () => {
    setJudgePromptSaving(true);
    setJudgePromptError(null);
    setJudgePromptSaveMessage(null);
    try {
      const response = await fetch("/api/evals/judge-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: judgePrompt }),
      });
      const payload = await readJsonResponse<JudgePromptResponse | { error?: string }>(response);
      if (!response.ok) {
        const message = payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Save failed: ${response.status}`;
        throw new Error(message);
      }
      if (!payload || !("prompt" in payload)) throw new Error("Save returned an invalid response.");

      setJudgePrompt(payload.prompt);
      setSavedJudgePrompt(payload.prompt);
      setDefaultJudgePrompt(payload.default_prompt);
      setJudgePromptPath(payload.prompt_path);
      setJudgePromptSaveMessage("Saved");
    } catch (saveError) {
      setJudgePromptError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setJudgePromptSaving(false);
    }
  }, [judgePrompt]);

  const applyEvalContextResponse = useCallback((payload: EvalContextResponse) => {
    setEvalContextDocuments(payload.documents);
    setEvalContextPath(payload.context_path);
    setEvalContextChars(payload.context_chars);
    setEvalContextError(payload.error ?? null);
  }, []);

  const addEvalContextFiles = useCallback(async (files: FileList) => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    setEvalContextAdding(true);
    setEvalContextError(null);
    try {
      const formData = new FormData();
      for (const file of selectedFiles) formData.append("files", file);

      const response = await fetch("/api/evals/context", {
        method: "POST",
        body: formData,
      });
      const payload = await readJsonResponse<EvalContextResponse | { error?: string }>(response);
      if (!response.ok) {
        const message = payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Context extraction failed: ${response.status}`;
        throw new Error(message);
      }
      if (!payload || !("documents" in payload)) throw new Error("Context extraction returned an invalid response.");
      applyEvalContextResponse(payload);
    } catch (contextError) {
      setEvalContextError(contextError instanceof Error ? contextError.message : String(contextError));
    } finally {
      setEvalContextAdding(false);
    }
  }, [applyEvalContextResponse]);

  const clearEvalContext = useCallback(async () => {
    if (evalContextDocuments.length === 0) return;
    const confirmed = window.confirm("Clear all added judge context files?");
    if (!confirmed) return;

    setEvalContextClearing(true);
    setEvalContextError(null);
    try {
      const response = await fetch("/api/evals/context", { method: "DELETE" });
      const payload = await readJsonResponse<EvalContextResponse | { error?: string }>(response);
      if (!response.ok) {
        const message = payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Clear context failed: ${response.status}`;
        throw new Error(message);
      }
      if (!payload || !("documents" in payload)) throw new Error("Clear context returned an invalid response.");
      applyEvalContextResponse(payload);
    } catch (contextError) {
      setEvalContextError(contextError instanceof Error ? contextError.message : String(contextError));
    } finally {
      setEvalContextClearing(false);
    }
  }, [applyEvalContextResponse, evalContextDocuments.length]);

  const resetRunContext = useCallback(async () => {
    if (workflowRunning || runContextResetting) return;
    const confirmed = window.confirm(
      "Reset the current run and restore data/runtime from data/store? "
      + "All mutable runtime changes will be discarded.",
    );
    if (!confirmed) return;

    setRunContextResetting(true);
    setWorkflowError(null);
    try {
      const response = await fetch("/api/runtime/reset", { method: "POST" });
      const payload = await readJsonResponse<RuntimeResetResponse | { error?: string }>(response);
      if (!response.ok) {
        const message = payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Runtime reset failed: ${response.status}`;
        throw new Error(message);
      }
      if (!payload || !("status" in payload) || payload.status !== "restored") {
        throw new Error("Runtime reset returned an invalid response.");
      }

      window.localStorage.removeItem(LOCAL_STORAGE_KEYS.currentRun);
      setSelectedScenarioId(scenarios[0]?.id ?? "");
      setWorkflowResult(null);
      setWorkflowError(null);
      setActiveRunTraceId(null);
      setSelectedTraceId(null);
      setLiveRunContext(null);
      setRunContextLookup(null);
      setInspectedTicketContext(null);
      setTicketContextError(null);
      setSelectedDetail(null);
      setRuntimeDataRevision((current) => current + 1);
    } catch (resetError) {
      setWorkflowError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setRunContextResetting(false);
    }
  }, [runContextResetting, scenarios, workflowRunning]);

  const submitScenarioRun = useCallback(async ({
    endpoint,
    requestBody,
    payloads,
    runLabel,
  }: {
    endpoint: string;
    requestBody: Record<string, unknown>;
    payloads: Array<Record<string, unknown>>;
    runLabel: string;
  }) => {
    const initialPayload = payloads[0];
    const initialTicketId = initialPayload
      ? getRecordString(initialPayload, "ticket_id") || undefined
      : undefined;
    setTicketContextError(null);
    setLiveRunContext({ ticket_id: initialTicketId ?? null, ticket: null, conversation: [] });
    setRunContextLookup({ ticket_id: initialTicketId });
    runTraceSelectionPendingRef.current = true;
    selectedTraceIdRef.current = null;
    setActiveRunTraceId(null);
    setSelectedTraceId(null);
    setWorkflowRunning(true);
    setWorkflowError(null);
    setWorkflowResult(null);
    setSelectedDetail(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result = await readWorkflowRunResponse(
        response,
        `${runLabel} failed: ${response.status}`,
      );
      const completedContext: RunContext = {
        ticket_id: result.ticket_id ?? null,
        ticket: result.ticket ?? null,
        conversation: result.ticket?.conversation ?? result.conversation ?? [],
      };
      setWorkflowResult(result);
      setActiveRunTraceId(result.trace_id);
      setLiveRunContext(completedContext);
      setRunContextLookup((current) => ({
        ...(current ?? {}),
        ticket_id: result.ticket_id,
      }));
      runTraceSelectionPendingRef.current = false;
      selectedTraceIdRef.current = result.trace_id;
      setSelectedTraceId(result.trace_id);
      setSelectedDetail(null);
      try {
        await saveRunSnapshot(result.trace_id, {
          version: 1,
          captured_at: new Date().toISOString(),
          result,
          context: completedContext,
          selected_scenario_id: selectedScenarioId,
          exact: true,
        });
      } catch (snapshotError) {
        setError(
          `Workflow completed, but its historical Runs view could not be saved: ${
            snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
          }`,
        );
      }
      refreshCompletedRun(result.trace_id);
    } catch (runError) {
      setWorkflowError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      runTraceSelectionPendingRef.current = false;
      setWorkflowRunning(false);
    }
  }, [refreshCompletedRun, selectedScenarioId]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;

  const runSelectedScenario = useCallback(async () => {
    if (!selectedScenario) {
      setWorkflowError("Select a scenario before starting a run.");
      return;
    }

    await submitScenarioRun({
      endpoint: "/api/scenarios/run",
      requestBody: { scenario_id: selectedScenario.id },
      payloads: selectedScenario.payloads,
      runLabel: "Scenario run",
    });
  }, [selectedScenario, submitScenarioRun]);

  const runPromptImprovement = useCallback(async () => {
    setPromptImprovementRunning(true);
    setPromptImprovement(null);
    setPromptImprovementError(null);
    try {
      const response = await fetch("/api/evals/prompt-improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trace_ids: evalResults.map((result) => result.trace_id),
          eval_results: evalResults,
          judge_model: judgeModel,
        }),
      });
      const payload = await readJsonResponse<PromptImprovementResult | { error?: string }>(response);
      if (!response.ok) {
        const errorMessage = isRecord(payload) && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Prompt optimizer failed: ${response.status}`;
        throw new Error(errorMessage);
      }
      if (!payload) throw new Error("Prompt optimizer returned an empty response.");
      setPromptImprovement(payload as PromptImprovementResult);
    } catch (improvementError) {
      setPromptImprovementError(improvementError instanceof Error ? improvementError.message : String(improvementError));
    } finally {
      setPromptImprovementRunning(false);
    }
  }, [evalResults, judgeModel]);

  return (
    <div className={`dashboard-shell is-density-compact ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="brand-block">
          <div className="eyebrow">Local Agents</div>
          <h1>Trace Dashboard</h1>
          <div className={`connection-pill ${connected ? "is-live" : "is-idle"}`}>
            <span /> {connected ? "Live" : "Waiting"}
          </div>
        </div>

        <button className="refresh-button" onClick={() => loadSummaries()}>
          Refresh traces
        </button>

        <div className="view-switcher">
          <button className={activeView === "runs" ? "is-active" : ""} onClick={() => setActiveView("runs")}>
            Runs
          </button>
          <button className={activeView === "traces" ? "is-active" : ""} onClick={() => setActiveView("traces")}>
            Traces
          </button>
          <button className={activeView === "evals" ? "is-active" : ""} onClick={() => setActiveView("evals")}>
            Evals
          </button>
          <button className={activeView === "data" ? "is-active" : ""} onClick={() => setActiveView("data")}>
            Data
          </button>
          <button className={activeView === "kpis" ? "is-active" : ""} onClick={() => setActiveView("kpis")}>
            KPIs
          </button>
        </div>

        <div className={`trace-list ${traceManagementMode ? "is-manage-mode" : ""}`}>
          {summaries.length > 0 ? (
            <div className="trace-sidebar-tools">
              <label className="trace-sidebar-search">
                <span>Find traces</span>
                <input
                  value={traceSidebarQuery}
                  onChange={(event) => setTraceSidebarQuery(event.target.value)}
                  placeholder="workflow, trace id, cost"
                />
              </label>
              <label className="trace-sidebar-status">
                <span>Status</span>
                <select
                  value={traceSidebarStatus}
                  onChange={(event) => setTraceSidebarStatus(event.target.value as TraceStatusFilter)}
                >
                  <option value="all">All</option>
                  <option value="errors">Has errors</option>
                  <option value="completed">Completed</option>
                  <option value="running">Running</option>
                </select>
              </label>
            </div>
          ) : null}
          {summaries.length === 0 ? (
            <div className="empty-state">Run `uv run python main.py` to create a local trace.</div>
          ) : null}
          {summaries.length > 0 ? (
            <div className={`trace-batch-toolbar ${traceManagementMode ? "is-manage-mode" : ""}`}>
              {traceManagementMode ? (
                <label className="trace-checkbox-label">
                  <input
                    type="checkbox"
                    checked={allVisibleBatchSelected}
                    onChange={() => {
                      setSelectedBatchTraceIds((current) => {
                        const next = new Set(current);
                        if (allVisibleBatchSelected) {
                          for (const traceId of visibleSidebarTraceIds) next.delete(traceId);
                        } else {
                          for (const traceId of visibleSidebarTraceIds) next.add(traceId);
                        }
                        return next;
                      });
                    }}
                    disabled={visibleSidebarTraceIds.length === 0}
                    aria-label={allVisibleBatchSelected ? "Clear visible trace selection" : "Select visible traces"}
                  />
                  <span>{selectedBatchTraceIds.size} selected total</span>
                </label>
              ) : (
                <span className="trace-management-hint">Edit to select and delete runs</span>
              )}
              <span className="trace-visible-count">{visibleSidebarSummaries.length}/{summaries.length}</span>
              <button
                className="trace-manage-button"
                type="button"
                onClick={() => {
                  if (traceManagementMode) setSelectedBatchTraceIds(new Set());
                  setTraceManagementMode((current) => !current);
                }}
              >
                {traceManagementMode ? "Done" : "Edit"}
              </button>
              {traceManagementMode ? (
                <button
                  className="trace-delete-button"
                  onClick={() => {
                    deleteTraces([...selectedBatchTraceIds]).catch((deleteError: Error) => setError(deleteError.message));
                  }}
                  disabled={selectedBatchTraceIds.size === 0 || batchDeleting}
                >
                  {batchDeleting ? "Deleting" : "Delete"}
                </button>
              ) : null}
            </div>
          ) : null}
          {summaries.length > 0 && visibleSidebarSummaries.length === 0 ? (
            <div className="empty-state">No traces match the current filter.</div>
          ) : null}
          {visibleSidebarSummaries.map((summary) => (
            <TraceSidebarItem
              key={summary.trace_id}
              summary={summary}
              selected={summary.trace_id === selectedTraceId}
              batchSelected={selectedBatchTraceIds.has(summary.trace_id)}
              managementMode={traceManagementMode}
              onToggleBatch={() => toggleBatchTrace(summary.trace_id)}
              onSelect={() => {
                setSelectedTraceId(summary.trace_id);
                setSelectedDetail(null);
                setActiveView("traces");
              }}
            />
          ))}
        </div>
      </aside>

      <main className="main-panel">
        {activeView === "runs" ? (
          <RunsPanel
            scenarios={scenarios}
            selectedScenarioId={selectedScenarioId}
            selectedScenario={selectedScenario}
            scenariosError={scenariosError}
            running={workflowRunning}
            displayRunning={isActiveRunSelected}
            resetting={runContextResetting}
            result={displayedRunResult}
            context={displayedRunContext}
            error={displayedRunError}
            contextError={ticketContextError}
            showingCurrentTicket={Boolean(viewingHistoricalRun && currentInspectedContext?.ticket)}
            selectedSummary={selectedSummary}
            viewingHistorical={viewingHistoricalRun}
            historicalSnapshotExact={selectedRunSnapshot?.exact ?? false}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            onScenarioChange={setSelectedScenarioId}
            onRunScenario={runSelectedScenario}
            onResetRunContext={resetRunContext}
          />
        ) : activeView === "evals" ? (
          <EvalsPanel
            summaries={summaries}
            selectedTraceIds={selectedEvalTraceIds}
            judgeModel={judgeModel}
            judgeModels={judgeModels}
            judgeBackendProvider={judgeBackendProvider}
            judgeBackendUsingFallback={judgeBackendUsingFallback}
            judgeApiKeySource={judgeApiKeySource}
            judgeModelsError={judgeModelsError}
            judgePrompt={judgePrompt}
            judgePromptPath={judgePromptPath}
            judgePromptDirty={judgePromptDirty}
            judgePromptDefaultDraft={judgePromptDefaultDraft}
            judgePromptSaving={judgePromptSaving}
            judgePromptError={judgePromptError}
            judgePromptSaveMessage={judgePromptSaveMessage}
            canRevertJudgePrompt={judgePromptDirty}
            canUseDefaultJudgePrompt={Boolean(defaultJudgePrompt) && judgePrompt !== defaultJudgePrompt}
            evalContextDocuments={evalContextDocuments}
            evalContextPath={evalContextPath}
            evalContextChars={evalContextChars}
            evalContextAdding={evalContextAdding}
            evalContextClearing={evalContextClearing}
            evalContextError={evalContextError}
            evalRunning={evalRunning}
            evalCompletedCount={evalCompletedCount}
            evalResults={evalResults}
            expandedResultIds={expandedEvalTraceIds}
            promptImprovementRunning={promptImprovementRunning}
            promptImprovement={promptImprovement}
            promptImprovementError={promptImprovementError}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            onJudgeModelChange={setJudgeModel}
            onJudgePromptChange={setJudgePrompt}
            onRevertJudgePrompt={() => {
              setJudgePrompt(savedJudgePrompt);
              setJudgePromptError(null);
              setJudgePromptSaveMessage(null);
            }}
            onUseDefaultJudgePrompt={() => {
              setJudgePrompt(defaultJudgePrompt);
              setJudgePromptError(null);
              setJudgePromptSaveMessage(null);
            }}
            onSaveJudgePrompt={saveJudgePrompt}
            onAddEvalContext={addEvalContextFiles}
            onClearEvalContext={clearEvalContext}
            onToggleTrace={toggleEvalTrace}
            onToggleResult={(traceId) => {
              setExpandedEvalTraceIds((current) => {
                const next = new Set(current);
                if (next.has(traceId)) next.delete(traceId);
                else next.add(traceId);
                return next;
              });
            }}
            onSelectAll={() => setSelectedEvalTraceIds(new Set(summaries.map((summary) => summary.trace_id)))}
            onSetTraceSelection={(traceIds) => setSelectedEvalTraceIds(new Set(traceIds))}
            onClear={() => setSelectedEvalTraceIds(new Set())}
            onClearResults={clearEvalResults}
            onRun={runEvals}
            onRunPromptImprovement={runPromptImprovement}
            onOpenTrace={(traceId) => {
              setSelectedTraceId(traceId);
              setSelectedDetail(null);
              setActiveView("traces");
            }}
          />
        ) : activeView === "kpis" ? (
          <KpiPanel
            revision={runtimeDataRevision}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          />
        ) : activeView === "data" ? (
          <DataPanel
            theme={theme}
            refreshVersion={runtimeDataRevision}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          />
        ) : (
          <>
        <header className="workbench-toolbar">
          <div className="toolbar-title">
            <div className="eyebrow">Trace Details</div>
            <h2>{selectedTraceDisplay ? getTraceDisplayName(selectedTraceDisplay) : "No trace selected"}</h2>
            {selectedTraceDisplay ? <code>{selectedTraceDisplay.trace_id}</code> : null}
          </div>
          <div className="toolbar-metrics">
            <Metric label="Status" value={selectedSummary?.status ?? "n/a"} />
            <Metric label="Errors" value={String(selectedSummary?.error_count ?? 0)} />
            <Metric label="Duration" value={formatMs(selectedSummary?.duration_ms)} />
            <Metric label="Spans" value={String(selectedSummary?.span_count ?? trace?.spans.length ?? 0)} />
            <Metric label="Tokens" value={formatNumber(selectedSummary?.total_tokens)} />
            <Metric label="Cost" value={formatCost(selectedSummary?.total_cost)} />
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="trace-filter-bar card">
          <div className="trace-filter-primary">
            <label className="search-control">
              <span>Search spans</span>
              <input
                className="trace-filter-search"
                value={spanFilters.search}
                onChange={(event) => updateSpanFilters({ search: event.target.value })}
                placeholder="name, id, agent, tool"
              />
            </label>
            <label className="trace-kind-control">
              <span>Type</span>
              <select value={spanFilters.kind} onChange={(event) => updateSpanFilters({ kind: event.target.value as SpanKindFilter })}>
                <option value="all">All spans</option>
                <option value="agent">Agents</option>
                <option value="tool">Tools</option>
                <option value="model">Models</option>
                <option value="guardrail">Guardrails</option>
              </select>
            </label>
            <div className="trace-tree-actions" aria-label="Span tree controls">
              <button onClick={expandAllSpans} title="Expand all spans">Expand all</button>
              <button onClick={collapseAllSpans} title="Collapse all spans">Collapse all</button>
            </div>
          </div>
          <div className="trace-filter-secondary">
            <div className="trace-filter-chips" aria-label="Span filters">
              <label className={`filter-chip ${spanFilters.quickFilter === "all" ? "is-active" : ""}`} title="Show every span that matches search and type">
                <input type="radio" name="span-quick-filter" checked={spanFilters.quickFilter === "all"} onChange={() => updateSpanFilters({ quickFilter: "all" })} />
                All
              </label>
              <label className={`filter-chip ${spanFilters.quickFilter === "files" ? "is-active" : ""}`} title="Show spans with captured attachments">
                <input type="radio" name="span-quick-filter" checked={spanFilters.quickFilter === "files"} onChange={() => updateSpanFilters({ quickFilter: "files" })} />
                Files
              </label>
              <label className={`filter-chip ${spanFilters.quickFilter === "slow" ? "is-active" : ""}`} title="Show the slowest 20% of spans in this trace, with at least 3 when available">
                <input type="radio" name="span-quick-filter" checked={spanFilters.quickFilter === "slow"} onChange={() => updateSpanFilters({ quickFilter: "slow" })} />
                Slowest 20%
              </label>
              <label className={`filter-chip ${spanFilters.quickFilter === "cost" ? "is-active" : ""}`} title="Show the highest-token 20% of spans in this trace, with at least 3 when available">
                <input type="radio" name="span-quick-filter" checked={spanFilters.quickFilter === "cost"} onChange={() => updateSpanFilters({ quickFilter: "cost" })} />
                Most tokens 20%
              </label>
              <label className={`filter-chip ${spanFilters.quickFilter === "triggered" ? "is-active" : ""}`} title="Show errored spans and triggered guardrails">
                <input type="radio" name="span-quick-filter" checked={spanFilters.quickFilter === "triggered"} onChange={() => updateSpanFilters({ quickFilter: "triggered" })} />
                Errors / triggered
              </label>
            </div>
            <div className="trace-filter-meta">
              <span>{visibleSpans.length}/{trace?.spans.length ?? 0} spans</span>
              {activeSpanFilterCount > 0 ? (
                <button onClick={() => setSpanFilters(DEFAULT_SPAN_FILTERS)} type="button">
                  Clear {activeSpanFilterCount}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="content-grid" style={{ "--inspector-width": `${paneLayout.inspectorWidth}px` } as CSSProperties}>
          <div className="left-stack">
            <section className="card trace-tree-card">
              <div className="section-title">
                <div>
                  <div className="eyebrow">Nested Structure</div>
                  <h3>Trace tree</h3>
                </div>
                <span>
                  {visibleSpans.length}/{trace?.spans.length ?? 0} spans
                  {" · "}{selectedSummary?.error_count ?? 0} errors
                  {" · "}{guardrailEvents.length} guardrails
                </span>
              </div>
              {filteredSpanTree.length ? (
                <div className="span-tree">
                  {filteredSpanTree.map((node) => (
                    <SpanNodeView
                      key={getSpanId(node.span)}
                      node={node}
                      depth={0}
                      selected={selectedDetail?.kind === "span" ? getSpanId(selectedDetail.value) : undefined}
                      selectedGuardrailEvent={selectedDetail?.kind === "event" ? getGuardrailEventIdentity(selectedDetail.value) : undefined}
                      collapsedNodes={collapsedNodes}
                      guardrailEventBySpanId={guardrailEventBySpanId}
                      timelineRange={timelineRange}
                      onToggle={toggleNode}
                      onSelect={(span) => setSelectedDetail({ kind: "span", value: span })}
                      onSelectGuardrailEvent={(event) => setSelectedDetail({ kind: "event", value: event })}
                      onPreviewAttachment={setAttachmentPreview}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state compact-state">No spans match the current filters.</div>
              )}
            </section>

          </div>

          <div className="pane-resizer" onPointerDown={startPaneResize} role="separator" aria-label="Resize inspector" />
          <aside className="card detail-card">
            <div className="section-title">
              <div>
                <div className="eyebrow">Inspector</div>
                {selectedDetail?.kind === "span" ? null : <h3>{getDetailTitle(selectedDetail)}</h3>}
              </div>
            </div>
            <Inspector
              detail={selectedDetail}
              trace={trace}
              onPreviewAttachment={setAttachmentPreview}
            />
          </aside>
        </section>
          </>
        )}
      </main>
      {attachmentPreview ? (
        <AttachmentPreviewModal
          preview={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  const normalizedStatus = normalizeStatus(status);
  const label = normalizedStatus === "unknown" ? "n/a" : normalizedStatus;
  return <span className={`status-pill is-${normalizedStatus}`}>{label}</span>;
}

function ErrorPill({ count }: { count: number }) {
  return (
    <span className="status-pill is-error">
      {count} {count === 1 ? "error" : "errors"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UsageStat({
  label,
  tokens,
  cost,
}: {
  label: string;
  tokens?: number;
  cost?: number | null;
}) {
  return (
    <div className="stat-card usage-stat">
      <span>{label}</span>
      <strong>{typeof tokens === "number" ? formatNumber(tokens) : "n/a"}</strong>
      <small>
        {typeof tokens === "number" ? "tokens" : "Token usage n/a"}
        {" · "}
        {typeof cost === "number" ? formatCost(cost) : "Cost n/a"}
      </small>
    </div>
  );
}

function UsageMetric({
  label,
  tokens,
  cost,
}: {
  label: string;
  tokens?: number;
  cost?: number | null;
}) {
  return (
    <span className="usage-metric">
      <b>{label}</b>
      <strong>{typeof tokens === "number" ? formatNumber(tokens) : "n/a"}</strong>
      <small>
        {typeof tokens === "number" ? "tokens" : "Token usage n/a"}
        {" · "}
        {typeof cost === "number" ? formatCost(cost) : "Cost n/a"}
      </small>
    </span>
  );
}

function InputUsageBlock({
  uncachedTokens,
  uncachedCost,
  cachedTokens,
  cachedCost,
  cacheWriteTokens,
  cacheWriteCost,
  variant,
}: {
  uncachedTokens?: number;
  uncachedCost?: number | null;
  cachedTokens?: number;
  cachedCost?: number | null;
  cacheWriteTokens?: number;
  cacheWriteCost?: number | null;
  variant: "stat" | "metric";
}) {
  const renderPart = (
    label: string,
    tokens: number | undefined,
    cost: number | null | undefined,
  ) => (
    <div className="input-usage-part">
      <b>{label}</b>
      <strong>{typeof tokens === "number" ? formatNumber(tokens) : "n/a"}</strong>
      <small>
        {typeof tokens === "number" ? "tokens" : "Token usage n/a"}
        {" · "}
        {typeof cost === "number" ? formatCost(cost) : "Cost n/a"}
      </small>
    </div>
  );

  return (
    <div className={`input-usage-block ${variant === "stat" ? "stat-card" : ""}`}>
      <span className="input-usage-heading">Input</span>
      <div className="input-usage-parts">
        {renderPart("Uncached Input", uncachedTokens, uncachedCost)}
        {renderPart("Cached Input", cachedTokens, cachedCost)}
        {renderPart("Cache Write", cacheWriteTokens, cacheWriteCost)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="toolbar-metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function Inspector({
  detail,
  trace,
  onPreviewAttachment,
}: {
  detail: SelectedDetail | null;
  trace: TraceRecord | null;
  onPreviewAttachment: (preview: AttachmentPreview) => void;
}) {
  if (detail?.kind === "span") {
    return <SpanInspector span={detail.value} onPreviewAttachment={onPreviewAttachment} />;
  }
  if (detail?.kind === "event" && detail.value.guardrail_name) {
    return <GuardrailEventInspector event={detail.value} />;
  }
  if (detail?.kind === "event") return <GenericInspector title="Event" value={detail.value} />;
  return <GenericInspector title="Trace" value={detail?.value ?? trace ?? {}} />;
}

function GuardrailEventInspector({ event }: { event: TraceEvent }) {
  const outputInfo = isRecord(event.output_info) ? event.output_info : null;
  const toolArguments = outputInfo?.tool_arguments;
  const toolOutput = outputInfo?.tool_output;
  const structuredOutput = outputInfo ? { ...outputInfo } : event.output_info;
  if (isRecord(structuredOutput)) {
    delete structuredOutput.tool_arguments;
    delete structuredOutput.tool_output;
  }
  const triggered = guardrailWasTriggered(event);

  return (
    <div className="structured-inspector">
      <div className="inspector-hero guardrail-inspector-hero">
        <div>
          <div className="inspector-method">{event.type.replaceAll("_", " ")}</div>
          <h4>{event.guardrail_name}</h4>
        </div>
        <div className="inspector-badges">
          <span className="kind-badge guardrail">guardrail</span>
          <span>{triggered ? "Triggered" : "Passed"}</span>
        </div>
      </div>
      <div className="inspector-sections">
        <InspectorSection title="Decision" defaultOpen>
          <div className="inspector-summary">
            <KeyValueGrid
              rows={[
                ["Result", triggered ? "Triggered" : "Passed"],
                ["Scope", event.guardrail_scope],
                ["Stage", event.guardrail_stage],
                ["Agent", event.agent_name],
                ["Tool", event.tool_name],
                ["Recorded", formatDateTime(event.timestamp)],
              ]}
            />
            <div className="inspector-text-block">
              <span className="inspector-label">Summary</span>
              <p>{getGuardrailEventSummary(event)}</p>
            </div>
          </div>
        </InspectorSection>
        <InspectorSection title="Structured output" defaultOpen>
          <JsonExplorer value={structuredOutput ?? {}} initialDepth={3} showFullText />
        </InspectorSection>
        {hasInspectorValue(toolArguments) ? (
          <InspectorSection title="Guarded tool arguments" defaultOpen>
            <JsonExplorer value={toolArguments} initialDepth={3} showFullText />
          </InspectorSection>
        ) : null}
        {hasInspectorValue(toolOutput) ? (
          <InspectorSection title="Guarded tool output" defaultOpen>
            <JsonExplorer value={toolOutput} initialDepth={3} showFullText />
          </InspectorSection>
        ) : null}
        <InspectorSection title="Raw event">
          <JsonExplorer value={event} initialDepth={2} showFullText />
        </InspectorSection>
      </div>
    </div>
  );
}

function GenericInspector({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="structured-inspector">
      <InspectorSection title={title} defaultOpen>
        <JsonExplorer value={value} initialDepth={2} />
      </InspectorSection>
    </div>
  );
}

function summarizeJsonValue(value: unknown, options?: { fullString?: boolean }) {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isRecord(value)) return `Object(${Object.keys(value).length})`;
  if (typeof value === "string") {
    if (options?.fullString || value.length <= 90) return JSON.stringify(value);
    return `${JSON.stringify(value.slice(0, 90)).slice(0, -1)}..."`;
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
}

function shouldCollapseJsonField(key: string | undefined, value: unknown) {
  const normalizedKey = key?.toLowerCase() ?? "";
  if (normalizedKey.includes("base64") || normalizedKey.includes("b64") || normalizedKey === "image_url") return true;
  if (normalizedKey === "instructions" && typeof value === "string" && value.length > 1000) return true;
  if (typeof value === "string" && value.length > 1600) return true;
  if (Array.isArray(value) && value.length > 30) return true;
  return false;
}

function getJsonSearchText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function getJsonValueClass(value: unknown) {
  if (Array.isArray(value) || isRecord(value)) return "is-container";
  if (typeof value === "string") return "is-string";
  if (typeof value === "number" || typeof value === "bigint") return "is-number";
  if (typeof value === "boolean") return "is-boolean";
  if (value === null || value === undefined) return "is-null";
  return "";
}

function jsonNodeHasMatch(value: unknown, keyName: string | undefined, query: string): boolean {
  if (!query) return true;
  if (keyName?.toLowerCase().includes(query)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => jsonNodeHasMatch(item, undefined, query));
  }
  if (isRecord(value)) {
    return Object.entries(value).some(([key, childValue]) => jsonNodeHasMatch(childValue, key, query));
  }
  return getJsonSearchText(value).toLowerCase().includes(query);
}

function highlightJsonText(text: string, query: string): ReactNode {
  if (!query) return text;

  const normalizedText = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(query, cursor);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const matchEnd = matchIndex + query.length;
    parts.push(<mark key={`${matchIndex}-${matchEnd}`}>{text.slice(matchIndex, matchEnd)}</mark>);
    cursor = matchEnd;
    matchIndex = normalizedText.indexOf(query, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function highlightEmbeddedKeyValueText(text: string, query: string): ReactNode {
  const keyPattern = /(?:^|[\s,{[(])([A-Za-z_][A-Za-z0-9_]*)(?=\s*=)|(?:'[^'\n]*'|"[^"\n]*")(?=\s*:)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = keyPattern.exec(text);

  while (match) {
    const keyText = match[1] ?? match[0];
    const keyStart = match.index + match[0].length - keyText.length;
    if (keyStart > cursor) {
      parts.push(highlightJsonText(text.slice(cursor, keyStart), query));
    }
    parts.push(
      <span className="json-embedded-key" key={`${keyStart}-${keyPattern.lastIndex}`}>
        {highlightJsonText(keyText, query)}
      </span>,
    );
    cursor = keyPattern.lastIndex;
    match = keyPattern.exec(text);
  }

  if (cursor < text.length) parts.push(highlightJsonText(text.slice(cursor), query));
  return parts.length ? parts : highlightJsonText(text, query);
}

function JsonExplorer({
  value,
  initialDepth = 1,
  showFullText = false,
}: {
  value: unknown;
  initialDepth?: number;
  showFullText?: boolean;
}) {
  const parsedValue = useMemo(() => parseJsonish(value), [value]);
  const [query, setQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyValue = useCallback(async (path: string, copyTarget: unknown) => {
    await navigator.clipboard.writeText(typeof copyTarget === "string" ? copyTarget : JSON.stringify(copyTarget, null, 2));
    setCopiedPath(path);
    window.setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 1400);
  }, []);

  const renderNode = (
    nodeValue: unknown,
    path: string,
    depth: number,
    keyName: string | undefined,
    isLast: boolean,
  ): ReactNode => {
    const isContainer = Array.isArray(nodeValue) || isRecord(nodeValue);
    const normalizedKey = keyName?.toLowerCase() ?? "";
    const isEncodedField = normalizedKey.includes("base64")
      || normalizedKey.includes("b64")
      || normalizedKey === "image_url";
    const hiddenLargeField = shouldCollapseJsonField(keyName, nodeValue)
      && !(showFullText && typeof nodeValue === "string" && !isEncodedField);
    const childEntries = Array.isArray(nodeValue)
      ? nodeValue.map((item, index) => [String(index), item] as const)
      : isRecord(nodeValue)
        ? Object.entries(nodeValue)
        : [];
    const canExpand = (isContainer && childEntries.length > 0) || (!isContainer && hiddenLargeField);
    const defaultExpanded = isContainer && depth < initialDepth && !hiddenLargeField;
    const queryText = query.trim().toLowerCase();
    const keyMatches = Boolean(queryText && keyName?.toLowerCase().includes(queryText));
    const valueMatches = Boolean(
      queryText
      && !isContainer
      && getJsonSearchText(nodeValue).toLowerCase().includes(queryText),
    );
    const descendantMatches = Boolean(
      queryText
      && isContainer
      && childEntries.some(([childKey, childValue]) => jsonNodeHasMatch(
        childValue,
        Array.isArray(nodeValue) ? undefined : childKey,
        queryText,
      )),
    );
    if (queryText && !keyMatches && !valueMatches && !descendantMatches) return null;

    const searchExpanded = Boolean(
      queryText && (descendantMatches || (!isContainer && valueMatches)),
    );
    const expanded = canExpand
      && (queryText
        ? searchExpanded
        : expandedPaths.has(path)
          || (defaultExpanded && !expandedPaths.has(`${path}:closed`)));
    const openingDelimiter = Array.isArray(nodeValue) ? "[" : "{";
    const closingDelimiter = Array.isArray(nodeValue) ? "]" : "}";
    const trailingComma = isLast ? "" : ",";
    const keyText = keyName === undefined ? "" : JSON.stringify(keyName);
    const primitiveText = hiddenLargeField && !expanded
      ? `Hidden large field · ${summarizeJsonValue(nodeValue)}${trailingComma}`
        : `${summarizeJsonValue(nodeValue, {
          fullString: showFullText || Boolean(queryText) || (hiddenLargeField && expanded),
        })}${trailingComma}`;

    const toggleExpanded = () => {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (expanded) {
          next.delete(path);
          next.add(`${path}:closed`);
        } else {
          next.add(path);
          next.delete(`${path}:closed`);
        }
        return next;
      });
    };

    return (
      <div className={`json-node ${keyMatches || valueMatches ? "is-match" : ""}`} key={path} style={{ "--depth": depth } as CSSProperties}>
        <div className="json-row">
          <button className="json-toggle" disabled={!canExpand} onClick={toggleExpanded} type="button">
            {canExpand ? (expanded ? "-" : "+") : ""}
          </button>
          <span className={`json-key ${keyName === undefined ? "is-empty" : ""}`} title={path}>
            {keyName === undefined ? null : (
              <>
                <span className="json-key-name">{highlightJsonText(keyText, queryText)}</span>
                <span className="json-key-colon">:</span>
              </>
            )}
          </span>
          <span className={`json-value is-wrapped ${getJsonValueClass(nodeValue)}`}>
            {isContainer
              ? expanded
                ? openingDelimiter
                : childEntries.length
                  ? `${openingDelimiter} … ${closingDelimiter}${trailingComma}`
                  : `${openingDelimiter}${closingDelimiter}${trailingComma}`
              : typeof nodeValue === "string"
                ? highlightEmbeddedKeyValueText(primitiveText, queryText)
                : highlightJsonText(primitiveText, queryText)}
          </span>
          <button className="json-copy" onClick={() => copyValue(path, nodeValue)} type="button">
            {copiedPath === path ? "Copied" : "Copy"}
          </button>
        </div>
        {isContainer && expanded ? (
          <>
            <div className="json-children">
              {childEntries.map(([childKey, childValue], index) => {
                const childPath = Array.isArray(nodeValue)
                  ? `${path}[${childKey}]`
                  : `${path}.${childKey}`;
                return renderNode(
                  childValue,
                  childPath,
                  depth + 1,
                  Array.isArray(nodeValue) ? undefined : childKey,
                  index === childEntries.length - 1,
                );
              })}
            </div>
            <div
              className="json-closing-delimiter"
              style={{ "--depth": depth } as CSSProperties}
            >
              {closingDelimiter}{trailingComma}
            </div>
          </>
        ) : null}
      </div>
    );
  };

  const renderRoot = () => {
    const isRootContainer = Array.isArray(parsedValue) || isRecord(parsedValue);
    const queryText = query.trim().toLowerCase();
    if (queryText && !jsonNodeHasMatch(parsedValue, undefined, queryText)) {
      return <div className="json-search-empty">No matching keys or values.</div>;
    }

    if (!isRootContainer) {
      const rootText = summarizeJsonValue(parsedValue, { fullString: true });
      return (
        <div className={`json-root-value ${getJsonValueClass(parsedValue)}`}>
          {typeof parsedValue === "string"
            ? highlightEmbeddedKeyValueText(rootText, queryText)
            : highlightJsonText(rootText, queryText)}
        </div>
      );
    }

    const rootEntries = Array.isArray(parsedValue)
      ? parsedValue.map((item, index) => [String(index), item] as const)
      : Object.entries(parsedValue);
    const openingDelimiter = Array.isArray(parsedValue) ? "[" : "{";
    const closingDelimiter = Array.isArray(parsedValue) ? "]" : "}";

    return (
      <div className="json-root">
        <div className="json-root-delimiter">{openingDelimiter}</div>
        {rootEntries.map(([childKey, childValue], index) => {
          const childPath = Array.isArray(parsedValue)
            ? `$[${childKey}]`
            : `$.${childKey}`;
          return renderNode(
            childValue,
            childPath,
            0,
            Array.isArray(parsedValue) ? undefined : childKey,
            index === rootEntries.length - 1,
          );
        })}
        <div className="json-root-delimiter">{closingDelimiter}</div>
      </div>
    );
  };

  return (
    <div className="json-explorer">
      <div className="json-toolbar">
        <input
          className="json-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search JSON"
          aria-label="Search JSON keys and values"
        />
      </div>
      <div className="json-tree">{renderRoot()}</div>
    </div>
  );
}

function SpanInspector({
  span,
  onPreviewAttachment,
}: {
  span: SpanRecord;
  onPreviewAttachment: (preview: AttachmentPreview) => void;
}) {
  const kind = getSpanKind(span);
  const data = getSpanData(span);
  const response = getResponseRecord(span);
  const usage = getUsage(span);
  const duration = getSpanDuration(span);
  const toolNames = getToolNames(response);
  const outputItems = getResponseOutput(response);
  const isResponse = kind === "model" || data.type === "response";
  const isFunction = data.type === "function" || kind === "tool";
  const generationModels = getGenerationModels(span);
  const attachments = getSpanAttachments(span);
  const inputValue = getSpanInput(span);
  const outputValue = getSpanOutput(span);
  const functionCalls = getFunctionCallItems(outputItems);
  const outputText = outputItems.map(getOutputText).filter(Boolean).join("\n\n");
  const instructionsText = typeof response?.instructions === "string" ? response.instructions : undefined;
  const spanError = span.error ? stringifyForDisplay(span.error) : null;
  const hasInput = hasInspectorValue(inputValue);
  const hasOutput = outputItems.length > 0 || hasInspectorValue(outputValue);

  return (
    <div className="structured-inspector">
      {spanError ? (
        <div className="span-error-banner">
          <strong>Span error</strong>
          <pre>{spanError}</pre>
        </div>
      ) : null}
      <div className="inspector-hero">
        <div>
          <div className="inspector-method">{isResponse ? "POST" : String(data.type ?? kind).toUpperCase()}</div>
          <h4>{isResponse ? "/v1/responses" : getSpanTitle(span)}</h4>
        </div>
        <div className="inspector-badges">
          <span className={`kind-badge ${kind}`}>{kind}</span>
          {usage.total ? <span>{formatNumber(usage.total)}t</span> : null}
          {duration !== undefined ? <span>{formatMs(duration)}</span> : null}
          <span>{String(span.id ?? span.span_id ?? "span")}</span>
        </div>
      </div>

      <div className="inspector-sections">
        <InspectorSection title="Summary" defaultOpen>
          <div className="inspector-summary">
            <KeyValueGrid
              rows={isFunction
                ? [
                    ["Created", formatDateTime(span.started_at ?? span.start_time)],
                    ["ID", String(span.id ?? span.span_id ?? "n/a")],
                    ["Duration", duration !== undefined ? formatMs(duration) : "n/a"],
                    ["Error", span.error ? stringifyForDisplay(span.error) : undefined],
                  ]
                : [
                    ["Created", formatDateTime(response?.created_at as number | undefined ?? span.started_at ?? span.start_time)],
                    ["ID", String(response?.id ?? span.id ?? span.span_id ?? "n/a")],
                    ["Model", generationModels.model],
                    ["Requested model", generationModels.requested],
                    ["Tokens", usage.total ? `${formatNumber(usage.total)} total` : undefined],
                    ["Functions", toolNames.length ? toolNames.map((name) => `${name}()`).join("\n") : undefined],
                    ["Triggered", typeof data.triggered === "boolean" ? String(data.triggered) : undefined],
                    ["Error", span.error ? stringifyForDisplay(span.error) : undefined],
                  ]}
            />
            {isResponse ? (
              <KeyValueGrid
                rows={[
                  ["Response", "text"],
                  ["Temperature", response?.temperature !== undefined ? String(response.temperature) : undefined],
                  ["Top P", response?.top_p !== undefined ? String(response.top_p) : undefined],
                    ["Tool choice", response?.tool_choice !== undefined ? stringifyForDisplay(response.tool_choice) : undefined],
                    ["Reasoning effort", isRecord(response?.reasoning) ? String(response.reasoning.effort ?? "none") : undefined],
                    ["Verbosity", isRecord(response?.text) ? String(response.text.verbosity ?? "medium") : undefined],
                    ["Instructions", instructionsText ? `${formatNumber(instructionsText.length)} chars loaded` : undefined],
                  ]}
              />
            ) : null}
            {instructionsText ? (
              <div className="inspector-text-block is-clamped">
                <span className="inspector-label">Instruction preview</span>
                {truncateForSummary(instructionsText)}
              </div>
            ) : null}
            {outputText ? (
              <div className="inspector-output-preview">
                <span className="inspector-label">Output preview</span>
                <p>{outputText}</p>
              </div>
            ) : null}
          </div>
        </InspectorSection>

        {hasInput ? (
          <InspectorSection
            title={usage.input ? `Input · ${formatNumber(usage.input)}t` : "Input"}
            defaultOpen
          >
            <JsonExplorer value={parseJsonish(inputValue)} initialDepth={2} showFullText />
          </InspectorSection>
        ) : null}

        {hasOutput ? (
          <InspectorSection
            title={usage.output ? `Output · ${formatNumber(usage.output)}t` : "Output"}
            defaultOpen
          >
            {outputItems.length ? (
              <div className="output-list">
                {outputItems.map((item, index) => (
                  <OutputItem key={index} item={item} />
                ))}
              </div>
            ) : (
              <JsonExplorer value={outputValue} initialDepth={2} />
            )}
          </InspectorSection>
        ) : null}

        {functionCalls.length ? (
          <InspectorSection title={`Tool Calls · ${functionCalls.length}`} defaultOpen>
            <div className="output-list">
              {toolNames.length ? (
                <div className="output-item-card">
                  <div className="output-item-title">Available functions</div>
                  <p className="function-call-name">{toolNames.map((name) => `${name}()`).join(", ")}</p>
                </div>
              ) : null}
              {functionCalls.map((item, index) => <OutputItem key={index} item={item} />)}
            </div>
          </InspectorSection>
        ) : null}

        {attachments.length ? (
          <InspectorSection title={`Attachments · ${attachments.length}`} defaultOpen>
            <AttachmentList attachments={attachments} onPreviewAttachment={onPreviewAttachment} />
          </InspectorSection>
        ) : null}

        <InspectorSection title="Raw" defaultOpen>
          <JsonExplorer value={getRawSpanForDisplay(span)} initialDepth={1} />
        </InspectorSection>
      </div>
    </div>
  );
}

function AttachmentList({
  attachments,
  onPreviewAttachment,
}: {
  attachments: TraceAttachment[];
  onPreviewAttachment: (preview: AttachmentPreview) => void;
}) {
  return (
    <div className="attachment-list">
      {attachments.map((attachment, index) => {
        const preview = createAttachmentPreview(attachment, attachments, index);
        const sourcePath = getAttachmentSourcePath(attachment);
        const pageNumber = getAttachmentPageNumber(attachment);
        const content = (
          <>
            <span className="attachment-file-icon" aria-hidden="true" />
            <span className="attachment-copy">
              <strong>{getAttachmentLabel(attachment)}</strong>
              <small>{sourcePath ?? getAttachmentFileName(attachment) ?? "No source path"}</small>
            </span>
            <span className="attachment-meta">
              {pageNumber ? `p${pageNumber}` : getAttachmentContentType(attachment)}
            </span>
          </>
        );

        if (!preview) {
          return (
            <div className="attachment-card is-disabled" key={attachmentKey(attachment, index)}>
              {content}
            </div>
          );
        }

        return (
          <button
            className="attachment-card"
            key={attachmentKey(attachment, index)}
            onClick={() => onPreviewAttachment(preview)}
            type="button"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function AttachmentPreviewModal({
  preview,
  onClose,
}: {
  preview: AttachmentPreview;
  onClose: () => void;
}) {
  const attachments = useMemo(() => (
    preview.attachments?.length ? preview.attachments : [preview.attachment]
  ), [preview.attachment, preview.attachments]);
  const [currentIndex, setCurrentIndex] = useState(preview.currentIndex ?? 0);
  const attachment = attachments[currentIndex] ?? preview.attachment;
  const documentKeyRef = useRef(
    getAttachmentSourcePath(attachment)
      ?? getAttachmentFileName(attachment)
      ?? attachmentKey(attachment, currentIndex),
  );
  const [page, setPage] = useState(getAttachmentPageNumber(attachment) ?? 1);
  const [scale, setScale] = useState(2);
  const [fitMode, setFitMode] = useState<"page" | "width" | "manual">("width");
  const [rotation, setRotation] = useState(0);
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const label = getAttachmentLabel(attachment);
  const sourcePath = getAttachmentSourcePath(attachment);
  const pageCount = meta?.page_count ?? getAttachmentPageNumber(attachment) ?? 1;
  const isPdf = isPdfAttachment(attachment);
  const canRenderAsImage = isPdf || isImageAttachment(attachment);
  const renderedHref = getAttachmentPreviewHref(attachment, { page, scale }) ?? preview.href;
  const originalHref = sourcePath
    ? `/api/attachments/preview?${new URLSearchParams({ path: sourcePath, raw: "1" }).toString()}`
    : renderedHref;
  const displayLabel = isPdf
    ? `${getAttachmentFileName(attachment) ?? label}, page ${page}`
    : label;
  const documentMeta = [
    isPdf ? `page ${page}` : getAttachmentMetaLabel(attachment),
    isPdf ? `${loadingMeta ? "..." : pageCount} pages` : getAttachmentContentType(attachment),
  ].filter(Boolean).join(" | ");

  useEffect(() => {
    setCurrentIndex(preview.currentIndex ?? 0);
  }, [preview]);

  useEffect(() => {
    const nextAttachment = attachments[currentIndex] ?? preview.attachment;
    const nextDocumentKey = getAttachmentSourcePath(nextAttachment)
      ?? getAttachmentFileName(nextAttachment)
      ?? attachmentKey(nextAttachment, currentIndex);
    const sameDocument = nextDocumentKey === documentKeyRef.current;
    setPage(getAttachmentPageNumber(nextAttachment) ?? 1);
    if (!sameDocument) {
      setScale(2);
      setFitMode("width");
      setRotation(0);
    }
    documentKeyRef.current = nextDocumentKey;
  }, [attachments, currentIndex, preview.attachment]);

  useEffect(() => {
    if (!isPdf) {
      setMeta(null);
      return;
    }
    const metaHref = getAttachmentPreviewHref(attachment, { meta: true });
    if (!metaHref) return;
    setLoadingMeta(true);
    fetch(metaHref)
      .then((response) => (response.ok ? response.json() as Promise<PdfMeta> : null))
      .then((payload) => setMeta(payload))
      .catch(() => setMeta(null))
      .finally(() => setLoadingMeta(false));
  }, [attachment, isPdf]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), pageCount));
  }, [pageCount]);

  const setZoom = (nextScale: number) => {
    setFitMode("manual");
    setScale(Math.min(Math.max(nextScale, 1), 4));
  };

  const selectPdfPage = (nextPage: number) => {
    const normalizedPage = Math.min(Math.max(nextPage, 1), pageCount);
    const matchingIndex = attachments.findIndex((item) => (
      getAttachmentSourcePath(item) === sourcePath
      && getAttachmentPageNumber(item) === normalizedPage
    ));
    setPage(normalizedPage);
    if (matchingIndex >= 0) setCurrentIndex(matchingIndex);
  };

  return (
    <div
      className="attachment-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={displayLabel}
      onMouseDown={onClose}
    >
      <div className="attachment-preview-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="attachment-preview-header">
          <div className="attachment-preview-title">
            <div className="eyebrow">Document Viewer</div>
            <h3>{displayLabel}</h3>
            {documentMeta ? <small>{documentMeta}</small> : null}
            {sourcePath ? <code>{sourcePath}</code> : null}
          </div>
          <div className="attachment-preview-actions">
            {isPdf ? (
              <>
                <button type="button" onClick={() => selectPdfPage(page - 1)} disabled={page <= 1}>Prev</button>
                <label className="page-control">
                  <span>Page</span>
                  <input
                    value={page}
                    onChange={(event) => {
                      const nextPage = Number(event.target.value);
                      if (Number.isInteger(nextPage)) selectPdfPage(nextPage);
                    }}
                  />
                  <span>/ {loadingMeta ? "..." : pageCount}</span>
                </label>
                <button type="button" onClick={() => selectPdfPage(page + 1)} disabled={page >= pageCount}>Next</button>
                <button type="button" className={fitMode === "width" ? "is-active" : ""} onClick={() => setFitMode("width")}>Width</button>
                <button type="button" className={fitMode === "page" ? "is-active" : ""} onClick={() => setFitMode("page")}>Page</button>
                <button type="button" onClick={() => setZoom(scale - 0.25)}>-</button>
                <span className="attachment-meta">{Math.round(scale * 100)}%</span>
                <button type="button" onClick={() => setZoom(scale + 0.25)}>+</button>
                <button type="button" onClick={() => setRotation((current) => (current + 90) % 360)}>Rotate</button>
              </>
            ) : null}
            <a href={originalHref} target="_blank" rel="noreferrer">Open original</a>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="attachment-preview-workspace">
          <aside className="attachment-preview-rail" aria-label="Attachments">
            <div className="attachment-preview-rail-header">
              <span>Attachments</span>
              <strong>{isPdf ? `${page}/${pageCount}` : `${currentIndex + 1}/${attachments.length}`}</strong>
            </div>
            <div className="attachment-preview-rail-list">
              {attachments.map((item, index) => {
                const itemSourcePath = getAttachmentSourcePath(item);
                const itemPage = getAttachmentPageNumber(item);
                const isActiveAttachment = index === currentIndex && (!isPdf || itemPage === page);
                return (
                  <button
                    key={attachmentKey(item, index)}
                    className={isActiveAttachment ? "is-active" : ""}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    title={itemSourcePath ?? getAttachmentLabel(item)}
                  >
                    <span className="attachment-file-icon" aria-hidden="true" />
                    <span>
                      <strong>{getAttachmentLabel(item)}</strong>
                      <small>{getAttachmentMetaLabel(item) || itemSourcePath || "file"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
          <div className={`attachment-preview-body fit-${fitMode}`}>
            {canRenderAsImage ? (
              <img
                src={renderedHref}
                alt={displayLabel}
                style={{
                  "--pdf-scale": scale,
                  transform: `rotate(${rotation}deg)`,
                } as CSSProperties}
              />
            ) : (
              <iframe src={renderedHref} title={displayLabel} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputItem({ item }: { item: unknown }) {
  if (!isRecord(item)) {
    return <JsonExplorer value={item} initialDepth={1} />;
  }

  if (item.type === "function_call") {
    return (
      <div className="output-item-card">
        <div className="output-item-title">Function call</div>
        <div className="function-call-name">{String(item.name ?? "function")}()</div>
        <div className="inspector-label">Arguments</div>
        <JsonExplorer value={parseJsonish(item.arguments)} initialDepth={2} />
        <div className="inspector-label">Output</div>
        <JsonExplorer value={item.output ?? "No output"} initialDepth={1} />
      </div>
    );
  }

  if (Array.isArray(item.content)) {
    return (
      <div className="output-item-card">
        <div className="output-item-title">Message</div>
        {item.content.map((contentItem, index) => (
          <JsonExplorer key={index} value={contentItem} initialDepth={1} />
        ))}
      </div>
    );
  }

  return <JsonExplorer value={item} initialDepth={1} />;
}

function InspectorSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="inspector-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="inspector-section-body">{children}</div>
    </details>
  );
}

function KeyValueGrid({ rows }: { rows: Array<[string, string | undefined]> }) {
  const visibleRows = rows.filter((row): row is [string, string] => row[1] !== undefined);
  return (
    <div className="key-value-grid">
      {visibleRows.map(([key, value]) => (
        <Fragment key={key}>
          <div>{key}</div>
          <div>{value}</div>
        </Fragment>
      ))}
    </div>
  );
}

function dataStatusClass(status?: string) {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (normalized.includes("closed") || normalized.includes("resolved")) return "is-closed";
  if (normalized.includes("waiting") || normalized.includes("escalated")) return "is-waiting";
  if (normalized.includes("new") || normalized.includes("open") || normalized.includes("active")) return "is-open";
  return "";
}

const DATA_VIEWS = {
  tickets: "Freshservice tickets",
  freshservice_kb: "Freshservice KB",
  confluence_documents: "Confluence documents",
} as const;
type DataView = keyof typeof DATA_VIEWS;
const CONFLUENCE_KINDS = {
  dependency_map: "Dependency map",
  access_layer: "Access Layer",
  knowledge_base: "Knowledge base",
} as const;

function DataPanel({ theme, refreshVersion, onToggleTheme }: {
  theme: "dark" | "light";
  refreshVersion: number;
  onToggleTheme: () => void;
}) {
  const [data, setData] = useState<RuntimeData | null>(null);
  const [view, setView] = useState<DataView>("tickets");
  const [selectedId, setSelectedId] = useState("");
  const [statusFilters, setStatusFilters] = useState<Record<DataView, string>>({
    tickets: "all", freshservice_kb: "all", confluence_documents: "all",
  });
  const [documentKind, setDocumentKind] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const loadData = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const result = await fetchJson<RuntimeData>("/api/runtime/data");
      if (version !== requestVersion.current) return;
      setData(result);
      setError(null);
    } catch (error) {
      if (version === requestVersion.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadData();
    return () => { requestVersion.current += 1; };
  }, [loadData]);
  useEffect(() => {
    if (!refreshVersion) return;
    const timer = window.setTimeout(() => { void loadData(); }, 150);
    return () => window.clearTimeout(timer);
  }, [loadData, refreshVersion]);

  const status = statusFilters[view];
  const sourceRecords = data?.[view] ?? [];
  const matchesType = (record: (typeof sourceRecords)[number]) => (
    view !== "confluence_documents" || documentKind === "all"
    || ("kind" in record && record.kind === documentKind)
  );
  const statuses = Array.from(new Set([
    ...(view === "tickets" ? [] : ["published", "draft"]),
    ...sourceRecords.map((record) => record.status),
    ...(status === "all" ? [] : [status]),
  ])).sort();
  const records = sourceRecords.filter((record) => (
    (status === "all" || record.status === status) && matchesType(record)
  ));
  const statusCount = (value: string) => sourceRecords.filter((record) => (
    (value === "all" || record.status === value) && matchesType(record)
  )).length;
  const kindCount = (value: string) => (data?.confluence_documents ?? []).filter((record) => (
    (value === "all" || record.kind === value) && (status === "all" || record.status === status)
  )).length;
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const ticket = selected && "subject" in selected ? selected : null;
  const document = selected && "body" in selected ? selected : null;

  return (
    <>
      <header className="workbench-toolbar">
        <div className="toolbar-title"><div className="eyebrow">Runtime data</div><h2>Agent working data</h2><p>Local Freshservice and Confluence records</p></div>
        <div className="toolbar-metrics">
          <Metric label="Tickets" value={String(data?.tickets.length ?? 0)} />
          <Metric label="Freshservice KB" value={String(data?.freshservice_kb.length ?? 0)} />
          <Metric label="Confluence" value={String(data?.confluence_documents.length ?? 0)} />
        </div>
        <div className="header-actions"><button className="theme-toggle" onClick={onToggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button></div>
      </header>
      <section className="card it-data-controls">
        <div className="it-data-tabs" role="tablist" aria-label="Runtime data views">
          {(Object.keys(DATA_VIEWS) as DataView[]).map((key) => (
            <button key={key} role="tab" aria-selected={view === key} className={view === key ? "is-active" : ""}
              onClick={() => { setView(key); setSelectedId(""); }}>
              {DATA_VIEWS[key]} <span>{data?.[key].length ?? 0}</span>
            </button>
          ))}
        </div>
        <button className="refresh-button" onClick={() => void loadData()} disabled={loading}>{loading ? "Loading..." : "Refresh data"}</button>
      </section>
      <section className="card knowledge-data-filters">
        <div className="data-filter-group" role="group" aria-label={view === "tickets" ? "Ticket status" : "Publication status"}>
          <span className="data-filter-label">{view === "tickets" ? "Ticket status" : "Publication status"}</span>
          <div className="data-filter-buttons">
            {["all", ...statuses].map((value) => (
              <button key={value} type="button" aria-pressed={status === value}
                className={status === value ? "is-active" : ""}
                onClick={() => { setStatusFilters((current) => ({ ...current, [view]: value })); setSelectedId(""); }}>
                {value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ")}
                <span>{statusCount(value)}</span>
              </button>
            ))}
          </div>
        </div>
        {view === "confluence_documents" ? (
          <div className="data-filter-group" role="group" aria-label="Document type">
            <span className="data-filter-label">Document type</span>
            <div className="data-filter-buttons">
              {[["all", "All"], ...Object.entries(CONFLUENCE_KINDS)].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={documentKind === value}
                  className={documentKind === value ? "is-active" : ""}
                  onClick={() => { setDocumentKind(value); setSelectedId(""); }}>
                  {label}<span>{kindCount(value)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {error ? <div className="error-banner">{error}{data ? " Previously loaded records are shown below." : ""}</div> : null}
      <div className="it-data-layout">
        <section className="card it-entity-list-card">
          <div className="section-title"><div><div className="eyebrow">Browse</div><h3>{DATA_VIEWS[view]}</h3></div><span>{records.length} records</span></div>
          <div className="it-entity-list">
            {records.map((record) => (
              <button key={record.id} className={`it-entity-row ${selected?.id === record.id ? "is-active" : ""}`} onClick={() => setSelectedId(record.id)}>
                <strong>{record.id} · {"subject" in record ? record.subject : record.title}</strong>
                <span>{"requester" in record ? actorLabel(record.requester) : "kind" in record ? CONFLUENCE_KINDS[record.kind] : "Support article"}</span>
                <small>{record.status}{"platform" in record && record.platform ? ` · ${record.platform}` : ""}</small>
              </button>
            ))}
            {!records.length ? <div className="empty-state">{loading ? "Loading records..." : status !== "all" || documentKind !== "all" && view === "confluence_documents" ? "No matching records." : "No records available."}</div> : null}
          </div>
        </section>
        <section className="card it-entity-detail-card">
          {selected ? <>
            <div className="section-title">
              <div><div className="eyebrow">{ticket ? "Freshservice ticket" : view === "freshservice_kb" ? "Freshservice article" : "Confluence document"}</div><h3>{selected.id} · {ticket ? ticket.subject : document?.title}</h3></div>
              <span className={`ticket-status ${dataStatusClass(selected.status)}`}>{selected.status}</span>
            </div>
            {ticket ? <TicketDetails ticket={ticket} /> : null}
            {document ? <>
              <dl className="it-property-grid">
                <div><dt>Version</dt><dd>{document.version}</dd></div>
                <div><dt>Updated</dt><dd>{document.updated_at ? formatDateTime(document.updated_at) : "Not recorded"}</dd></div>
                {"kind" in document ? <>
                  <div><dt>Document type</dt><dd>{CONFLUENCE_KINDS[document.kind]}</dd></div>
                  <div><dt>Author</dt><dd>{document.author || "Not recorded"}</dd></div>
                  <div><dt>Created</dt><dd>{document.created_at ? formatDateTime(document.created_at) : "Not recorded"}</dd></div>
                </> : <>
                  <div><dt>Owner group</dt><dd>{document.owner_group_id}</dd></div>
                  <div><dt>Platforms</dt><dd>{document.platforms.join(", ") || "None"}</dd></div>
                  <div><dt>Processes</dt><dd>{document.process_ids.join(", ") || "None"}</dd></div>
                  <div><dt>Tags</dt><dd>{document.tags.join(", ") || "None"}</dd></div>
                </>}
              </dl>
              <KnowledgeDocumentBody body={document.body} />
            </> : null}
          </> : <div className="empty-state it-detail-empty">{loading ? "Loading records..." : "Select a record to view details."}</div>}
        </section>
      </div>
    </>
  );
}

function RunsPanel({
  scenarios, selectedScenarioId, selectedScenario, scenariosError,
  running, displayRunning, resetting, result, context, error, contextError,
  selectedSummary, viewingHistorical, historicalSnapshotExact, showingCurrentTicket,
  theme, onToggleTheme, onScenarioChange, onRunScenario, onResetRunContext,
}: {
  scenarios: ScenarioOption[];
  selectedScenarioId: string;
  selectedScenario: ScenarioOption | null;
  scenariosError: string | null;
  running: boolean;
  displayRunning: boolean;
  resetting: boolean;
  result: AgentRunResult | null;
  context: RunContext | null;
  error: string | null;
  contextError: string | null;
  selectedSummary: TraceSummary | null;
  viewingHistorical: boolean;
  historicalSnapshotExact: boolean;
  showingCurrentTicket: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onScenarioChange: (scenarioId: string) => void;
  onRunScenario: () => void;
  onResetRunContext: () => void;
}) {
  const runErrorMessage = error ?? getWorkflowFailureMessage(result);
  const runStatus = runErrorMessage ? "error" : displayRunning ? "running" : result ? "completed" : "ready";
  const workflowOutput = isRecord(result?.workflow_output) ? result.workflow_output : null;
  const outcomeSummary = workflowOutput ? getRecordString(workflowOutput, "summary") : "";
  const outcomeNextAction = workflowOutput ? getRecordString(workflowOutput, "next_action") : "";
  const ticket = context?.ticket;
  return (
    <>
      <header className="workbench-toolbar">
        <div className="toolbar-title">
          <div className="eyebrow">Workflow Runs</div>
          <h2>{selectedSummary ? getTraceDisplayName(selectedSummary) : "Scenario runs"}</h2>
          {selectedSummary ? <code>{selectedSummary.trace_id}</code> : null}
        </div>
        <div className="toolbar-metrics">
          <Metric label="Status" value={displayRunning ? "running" : result?.status ?? selectedSummary?.status ?? "ready"} />
          <Metric label="Ticket" value={context?.ticket_id ?? "none"} />
        </div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={onToggleTheme}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <section className="run-grid run-cockpit-grid">
        <div className="run-control-column">
          <section className="card run-config-card">
            <div className="section-title">
              <div><div className="eyebrow">Launch</div><h3>Run scenario</h3></div>
              <span className={`run-state-chip ${runStatus}`}>{runStatus}</span>
            </div>
            <div className="run-controls">
              <div className="scenario-picker">
                <label>
                  <span>Scenario</span>
                  <select
                    value={selectedScenarioId}
                    onChange={(event) => onScenarioChange(event.target.value)}
                    disabled={running || resetting || scenarios.length === 0}
                  >
                    {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.id}</option>)}
                  </select>
                </label>
                {scenariosError ? <div className="error-banner run-error">{scenariosError}</div> : null}
                {selectedScenario ? (
                  <div className="scenario-preview">
                    {selectedScenario.description ? <p>{selectedScenario.description}</p> : null}
                    <details>
                      <summary>View scenario payloads ({selectedScenario.payloads.length})</summary>
                      <pre>{JSON.stringify(selectedScenario.payloads, null, 2)}</pre>
                    </details>
                  </div>
                ) : !scenariosError ? <div className="empty-state">No scenarios found.</div> : null}
              </div>
              <p className="scenario-run-help">Running a scenario restores baseline fixtures first.</p>
              <div className="eval-control-buttons">
                <button className="primary-action" onClick={onRunScenario} disabled={running || resetting || !selectedScenario}>
                  {running ? "Running scenario..." : "Reset context & run scenario"}
                </button>
                <button className="run-context-reset-button" onClick={onResetRunContext} disabled={running || resetting}>
                  {resetting ? "Resetting..." : "Reset context"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="run-context-column">
          {viewingHistorical ? (
            <section className={`card historical-run-notice ${historicalSnapshotExact ? "is-exact" : "is-derived"}`}>
              <div>
                <div className="eyebrow">Historical run</div>
                <strong>{historicalSnapshotExact ? "Showing the saved ticket from this workflow."
                  : showingCurrentTicket ? "Showing the current local ticket for this workflow."
                  : "Showing the recorded workflow outcome."}</strong>
              </div>
              {!historicalSnapshotExact ? <span>The final ticket snapshot was not saved for this run. Current ticket data may include later changes.</span> : null}
            </section>
          ) : null}

          {workflowOutput ? (
            <section className="card run-outcome-card">
              <div className="section-title">
                <div><div className="eyebrow">Workflow outcome</div><h3>{getRecordString(workflowOutput, "status") || result?.status || "Completed"}</h3></div>
              </div>
              {outcomeSummary ? <p>{outcomeSummary}</p> : null}
              {outcomeNextAction ? <div className="run-outcome-next-action"><strong>Next action</strong><span>{outcomeNextAction}</span></div> : null}
            </section>
          ) : null}

          <section className="card run-ticket-card">
            <div className="section-title">
              <div>
                <div className="eyebrow">{viewingHistorical && historicalSnapshotExact ? "Saved ticket" : "Current ticket"}</div>
                <h3>{context?.ticket_id ? `${context.ticket_id} · ${ticket?.subject || "Loading ticket"}` : "No ticket selected"}</h3>
              </div>
              {ticket?.status ? <span className={`ticket-status ${dataStatusClass(ticket.status)}`}>{ticket.status}</span> : null}
            </div>
            {runErrorMessage ? <div className="error-banner run-error">{runErrorMessage}</div> : null}
            {contextError ? <div className="error-banner run-error">Unable to load ticket: {contextError}</div> : null}
            {ticket ? (
                <TicketDetails ticket={ticket} />
            ) : !contextError ? (
              <div className="run-empty-monitor">
                <strong>{context?.ticket_id ? "Loading ticket" : "No active ticket"}</strong>
                <span>{context?.ticket_id ? `Reading ${context.ticket_id} from the local runtime.` : "Select and run a scenario to inspect its ticket."}</span>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </>
  );
}

function EvalsPanel({
  summaries,
  selectedTraceIds,
  judgeModel,
  judgeModels,
  judgeBackendProvider,
  judgeBackendUsingFallback,
  judgeApiKeySource,
  judgeModelsError,
  judgePrompt,
  judgePromptPath,
  judgePromptDirty,
  judgePromptDefaultDraft,
  judgePromptSaving,
  judgePromptError,
  judgePromptSaveMessage,
  canRevertJudgePrompt,
  canUseDefaultJudgePrompt,
  evalContextDocuments,
  evalContextPath,
  evalContextChars,
  evalContextAdding,
  evalContextClearing,
  evalContextError,
  evalRunning,
  evalCompletedCount,
  evalResults,
  expandedResultIds,
  promptImprovementRunning,
  promptImprovement,
  promptImprovementError,
  theme,
  onToggleTheme,
  onJudgeModelChange,
  onJudgePromptChange,
  onRevertJudgePrompt,
  onUseDefaultJudgePrompt,
  onSaveJudgePrompt,
  onAddEvalContext,
  onClearEvalContext,
  onToggleTrace,
  onToggleResult,
  onSelectAll,
  onSetTraceSelection,
  onClear,
  onClearResults,
  onRun,
  onRunPromptImprovement,
  onOpenTrace,
}: {
  summaries: TraceSummary[];
  selectedTraceIds: Set<string>;
  judgeModel: string;
  judgeModels: string[];
  judgeBackendProvider: JudgeBackendProvider;
  judgeBackendUsingFallback: boolean;
  judgeApiKeySource: JudgeApiKeySource | null;
  judgeModelsError: string | null;
  judgePrompt: string;
  judgePromptPath: string;
  judgePromptDirty: boolean;
  judgePromptDefaultDraft: boolean;
  judgePromptSaving: boolean;
  judgePromptError: string | null;
  judgePromptSaveMessage: string | null;
  canRevertJudgePrompt: boolean;
  canUseDefaultJudgePrompt: boolean;
  evalContextDocuments: EvalContextDocument[];
  evalContextPath: string;
  evalContextChars: number;
  evalContextAdding: boolean;
  evalContextClearing: boolean;
  evalContextError: string | null;
  evalRunning: boolean;
  evalCompletedCount: number;
  evalResults: EvalRunResult[];
  expandedResultIds: Set<string>;
  promptImprovementRunning: boolean;
  promptImprovement: PromptImprovementResult | null;
  promptImprovementError: string | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onJudgeModelChange: (model: string) => void;
  onJudgePromptChange: (prompt: string) => void;
  onRevertJudgePrompt: () => void;
  onUseDefaultJudgePrompt: () => void;
  onSaveJudgePrompt: () => void;
  onAddEvalContext: (files: FileList) => void;
  onClearEvalContext: () => void;
  onToggleTrace: (traceId: string) => void;
  onToggleResult: (traceId: string) => void;
  onSelectAll: () => void;
  onSetTraceSelection: (traceIds: string[]) => void;
  onClear: () => void;
  onClearResults: () => void;
  onRun: () => void;
  onRunPromptImprovement: () => void;
  onOpenTrace: (traceId: string) => void;
}) {
  const contextInputRef = useRef<HTMLInputElement | null>(null);
  const [evalTraceQuery, setEvalTraceQuery] = useState("");
  const successfulResults = useMemo(
    () => evalResults.filter((result) => !result.error && typeof result.score === "number"),
    [evalResults],
  );
  const passCount = evalResults.filter((result) => result.verdict === "pass").length;
  const failCount = evalResults.filter((result) => result.verdict === "fail").length;
  const errorCount = evalResults.filter((result) => result.error).length;
  const averageScore = successfulResults.length
    ? successfulResults.reduce((total, result) => total + (result.score ?? 0), 0) / successfulResults.length
    : 0;
  const passRate = successfulResults.length ? (passCount / successfulResults.length) * 100 : 0;
  const resultsWithCacheUsage = evalResults.filter(
    (result) => typeof result.cached_tokens === "number" && typeof result.cache_write_tokens === "number",
  );
  const totalCachedTokens = resultsWithCacheUsage.reduce(
    (total, result) => total + (result.cached_tokens ?? 0),
    0,
  );
  const totalCacheWriteTokens = resultsWithCacheUsage.reduce(
    (total, result) => total + (result.cache_write_tokens ?? 0),
    0,
  );
  const resultsWithTokenUsage = evalResults.filter(
    (result) => (
      typeof result.input_tokens === "number"
      && typeof result.output_tokens === "number"
      && typeof result.total_tokens === "number"
    ),
  );
  const totalUncachedInputTokens = resultsWithTokenUsage.reduce(
    (total, result) => total + (result.uncached_input_tokens ?? 0),
    0,
  );
  const totalOutputTokens = resultsWithTokenUsage.reduce(
    (total, result) => total + (result.output_tokens ?? 0),
    0,
  );
  const totalReasoningTokens = resultsWithTokenUsage.reduce(
    (total, result) => total + (result.reasoning_tokens ?? 0),
    0,
  );
  const totalJudgeTokens = resultsWithTokenUsage.reduce(
    (total, result) => total + (result.total_tokens ?? 0),
    0,
  );
  const resultsWithCacheWriteCost = evalResults.filter(
    (result) => typeof result.cache_write_cost === "number",
  );
  const totalCacheWriteCost = resultsWithCacheWriteCost.reduce(
    (total, result) => total + (result.cache_write_cost ?? 0),
    0,
  );
  const resultsWithCostUsage = evalResults.filter(
    (result) => (
      typeof result.input_cost === "number"
      && typeof result.output_cost === "number"
      && typeof result.total_cost === "number"
    ),
  );
  const totalUncachedInputCost = resultsWithCostUsage.reduce(
    (total, result) => total + (result.uncached_input_cost ?? 0),
    0,
  );
  const totalCachedInputCost = resultsWithCostUsage.reduce(
    (total, result) => total + (result.cached_input_cost ?? 0),
    0,
  );
  const totalOutputCost = resultsWithCostUsage.reduce(
    (total, result) => total + (result.output_cost ?? 0),
    0,
  );
  const totalJudgeCost = resultsWithCostUsage.reduce(
    (total, result) => total + (result.total_cost ?? 0),
    0,
  );
  const totalReasoningCost = resultsWithCostUsage.reduce(
    (total, result) => total + (result.reasoning_cost ?? 0),
    0,
  );
  const canRunPromptImprovement = !evalRunning && evalResults.length > 0;
  const summaryByTraceId = useMemo(() => new Map(summaries.map((summary) => [summary.trace_id, summary])), [summaries]);
  const filteredEvalSummaries = summaries.filter((summary) => {
    const query = evalTraceQuery.trim().toLowerCase();
    if (!query) return true;
    return `${getTraceDisplayName(summary)} ${summary.trace_id}`.toLowerCase().includes(query);
  });
  const copyEvalReasoning = useCallback(async (result: EvalRunResult) => {
    await navigator.clipboard.writeText([
      result.trace_summary ? `Trace summary: ${result.trace_summary}` : "",
      result.error ?? result.reasoning ?? "",
      result.hallucination_reasoning ? `Hallucination: ${result.hallucination_reasoning}` : "",
      result.issues?.length ? `Issues: ${result.issues.join("; ")}` : "",
    ].filter(Boolean).join("\n\n"));
  }, []);
  const exportEvalReport = useCallback(() => {
    downloadEvalReport(evalResults, promptImprovement, summaries);
  }, [evalResults, promptImprovement, summaries]);

  return (
    <>
      <header className="workbench-toolbar">
        <div className="toolbar-title">
          <div className="eyebrow">Trace Evals</div>
          <h2>LLM judge</h2>
          <code>Dynamic context: added files, judge prompt, tools, guardrails, and main workflow source</code>
        </div>
        <div className="toolbar-metrics">
          <Metric label="Selected" value={String(selectedTraceIds.size)} />
          <Metric label="Results" value={String(evalResults.length)} />
          <Metric label="Pass rate" value={successfulResults.length ? `${passRate.toFixed(0)}%` : "n/a"} />
          <Metric label="Avg score" value={successfulResults.length ? averageScore.toFixed(1) : "n/a"} />
        </div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={onToggleTheme}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <section className="card eval-judge-setup-card">
        <div className="section-title">
          <div>
            <div className="eyebrow">Setup</div>
            <h3>Judge setup</h3>
          </div>
        </div>
        <div className="eval-judge-setup-grid">
          <div className="eval-controls eval-judge-meta">
            <label>
              <span>Judge model</span>
              <select
                value={judgeModel}
                disabled={!judgeModels.length}
                onChange={(event) => onJudgeModelChange(event.target.value)}
              >
                {judgeModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <span className={`judge-backend-chip ${judgeBackendProvider}`}>
                Judge backend: {formatJudgeBackend(judgeBackendProvider, judgeBackendUsingFallback)}
                {judgeApiKeySource ? ` · ${formatJudgeApiKeySource(judgeApiKeySource)}` : ""}
              </span>
              {judgeModelsError ? <small className="prompt-note">{judgeModelsError}</small> : null}
            </label>
            <div className="judge-context-panel">
              <input
                ref={contextInputRef}
                className="hidden-file-input"
                type="file"
                multiple
                accept=".pdf,.md,.markdown,.txt,.json,.csv,.yaml,.yml,.xml,.html,.log,.py,.ts,.tsx,.js,.jsx,image/*"
                onChange={(event) => {
                  if (event.target.files) onAddEvalContext(event.target.files);
                  event.target.value = "";
                }}
              />
              <div className="judge-context-header">
                <small>
                  {evalContextDocuments.length
                    ? `${evalContextDocuments.length} file${evalContextDocuments.length === 1 ? "" : "s"} | ${formatBytes(evalContextChars)} generated`
                    : "Add PRD or other supporting files for the judge to review."}
                  {evalContextPath && evalContextDocuments.length ? ` | ${evalContextPath}` : ""}
                </small>
              </div>
              <div className="eval-control-buttons">
                <button
                  disabled={evalContextAdding || evalContextClearing}
                  onClick={() => contextInputRef.current?.click()}
                >
                  {evalContextAdding ? "Adding context..." : "Add context"}
                </button>
                <button
                  disabled={evalContextAdding || evalContextClearing || evalContextDocuments.length === 0}
                  onClick={onClearEvalContext}
                >
                  {evalContextClearing ? "Clearing..." : "Clear context"}
                </button>
              </div>
              {evalContextError ? <small className="prompt-note error">{evalContextError}</small> : null}
              {evalContextDocuments.length ? (
                <div className="context-doc-list">
                  {evalContextDocuments.map((document) => (
                    <div key={document.id} className="context-doc-row">
                      <div>
                        <strong>{document.source_name}</strong>
                        <small>
                          {formatBytes(document.size_bytes)}
                          {document.page_count ? ` | ${document.page_count} pages` : ""}
                          {document.image_count ? ` | ${document.image_count} images detected` : ""}
                        </small>
                      </div>
                      <code>{document.generated_path}</code>
                      {document.warning ? <small className="prompt-note">{document.warning}</small> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <label className="eval-controls judge-prompt-panel">
            <span>Judge prompt</span>
            <textarea
              value={judgePrompt}
              onChange={(event) => onJudgePromptChange(event.target.value)}
              rows={7}
            />
            <small className="prompt-note">
              Current agent, tool, guardrail, and workflow source is appended automatically.
            </small>
            <small className={`prompt-note ${judgePromptError ? "error" : ""}`}>
              {judgePromptError
                ? judgePromptError
                : `${judgePromptDefaultDraft ? "Default loaded, save to overwrite prompt file" : judgePromptDirty ? "Unsaved changes" : judgePromptSaveMessage ?? "Saved"}${judgePromptPath ? ` | ${judgePromptPath}` : ""}`}
            </small>
          </label>
        </div>
        <div className="eval-control-buttons eval-setup-actions">
          <button disabled={!canRevertJudgePrompt} onClick={onRevertJudgePrompt}>Revert changes</button>
          <button disabled={!canUseDefaultJudgePrompt} onClick={onUseDefaultJudgePrompt}>Use default</button>
          <button disabled={judgePromptSaving || !judgePromptDirty || !judgePrompt.trim()} onClick={onSaveJudgePrompt}>
            {judgePromptSaving ? "Saving..." : "Save prompt"}
          </button>
        </div>
      </section>

      <section className="eval-grid">
        <section className="card eval-config-card">
          <div className="section-title">
            <div>
              <div className="eyebrow">Selection</div>
              <h3>Choose traces</h3>
            </div>
            <span>{selectedTraceIds.size} selected</span>
          </div>

          <div className="eval-control-buttons eval-run-bar">
            <button onClick={() => onSetTraceSelection(filteredEvalSummaries.map((summary) => summary.trace_id))}>Select filtered</button>
            <button onClick={onSelectAll}>Select all</button>
            <button onClick={onClear}>Clear selection</button>
            <button
              className="primary-action"
              disabled={evalRunning || selectedTraceIds.size === 0 || !judgeModel || judgeBackendProvider === "unavailable"}
              onClick={onRun}
            >
              {evalRunning ? "Running evals..." : "Run evals"}
            </button>
          </div>
          {evalRunning ? (
            <div className="eval-progress">
              Running · {evalCompletedCount}/{selectedTraceIds.size} complete
            </div>
          ) : null}

          <div className="eval-selection-toolbar">
            <label className="search-control">
              <span>Find traces</span>
              <input
                value={evalTraceQuery}
                onChange={(event) => setEvalTraceQuery(event.target.value)}
                placeholder="scenario, trace id"
              />
            </label>
            <span>{filteredEvalSummaries.length}/{summaries.length} visible</span>
          </div>

          <div className="eval-trace-list">
            {filteredEvalSummaries.map((summary) => (
              <label key={summary.trace_id} className="eval-trace-row">
                <input
                  type="checkbox"
                  checked={selectedTraceIds.has(summary.trace_id)}
                  onChange={() => onToggleTrace(summary.trace_id)}
                />
                <span>
                  <TraceName trace={summary} compact />
                  <small>
                    {summary.event_count} events · {summary.span_count} spans · {formatNumber(summary.total_tokens)} tokens · {formatCost(summary.total_cost)}
                  </small>
                </span>
              </label>
            ))}
          </div>

        </section>

        <section className="card eval-results-card">
          <div className="section-title">
            <div>
              <div className="eyebrow">Results</div>
              <h3>Judge output</h3>
            </div>
            <div className="eval-control-buttons">
              <span>{evalResults.length} results</span>
              <button
                type="button"
                disabled={evalRunning || promptImprovementRunning || evalResults.length === 0}
                onClick={exportEvalReport}
              >
                Export HTML report
              </button>
              <button
                type="button"
                disabled={evalRunning || promptImprovementRunning || evalResults.length === 0}
                onClick={onClearResults}
              >
                Clear results
              </button>
            </div>
          </div>

          <div className="eval-stats-grid">
            <Stat label="Completed" value={`${evalResults.length}/${selectedTraceIds.size}`} />
            <Stat label="Average Score" value={successfulResults.length ? averageScore.toFixed(1) : "n/a"} />
            <Stat label="Pass Rate" value={successfulResults.length ? `${passRate.toFixed(0)}%` : "n/a"} />
            <Stat label="Pass / Fail" value={`${passCount} / ${failCount}`} />
            <Stat label="Errors" value={String(errorCount)} />
          </div>

          <section className="eval-usage-section" aria-labelledby="eval-aggregate-usage-heading">
            <h4 className="eval-subheading" id="eval-aggregate-usage-heading">Usage</h4>
            <div className="eval-stats-grid">
              <InputUsageBlock
                variant="stat"
                uncachedTokens={resultsWithTokenUsage.length ? totalUncachedInputTokens : undefined}
                uncachedCost={resultsWithCostUsage.length ? totalUncachedInputCost : null}
                cachedTokens={resultsWithCacheUsage.length ? totalCachedTokens : undefined}
                cachedCost={resultsWithCostUsage.length ? totalCachedInputCost : null}
                cacheWriteTokens={resultsWithCacheUsage.length ? totalCacheWriteTokens : undefined}
                cacheWriteCost={resultsWithCacheWriteCost.length ? totalCacheWriteCost : null}
              />
              <UsageStat
                label="Output"
                tokens={resultsWithTokenUsage.length ? totalOutputTokens : undefined}
                cost={resultsWithCostUsage.length ? totalOutputCost : null}
              />
              <UsageStat
                label="Reasoning"
                tokens={resultsWithTokenUsage.length ? totalReasoningTokens : undefined}
                cost={resultsWithCostUsage.length ? totalReasoningCost : null}
              />
              <UsageStat
                label="Total"
                tokens={resultsWithTokenUsage.length ? totalJudgeTokens : undefined}
                cost={resultsWithCostUsage.length ? totalJudgeCost : null}
              />
            </div>
          </section>

          <div className="eval-results-table-wrap">
            {evalResults.length === 0 ? <div className="empty-state">Run evals to see pass/fail, score, and reasoning.</div> : null}
            {evalResults.length ? (
              <table className="eval-results-table">
                <thead>
                  <tr>
                    <th>Trace</th>
                    <th>Judge</th>
                    <th>Verdict</th>
                    <th>Score</th>
                    <th>Hallucination</th>
                  </tr>
                </thead>
                <tbody>
                  {evalResults.map((result) => {
                    const isExpanded = expandedResultIds.has(result.trace_id);
                    const traceLabel = summaryByTraceId.get(result.trace_id) ?? { trace_id: result.trace_id };
                    return (
                      <Fragment key={result.trace_id}>
                        <tr
                          className={`eval-clickable-row ${result.error ? "error" : result.verdict}`}
                          onClick={() => onToggleResult(result.trace_id)}
                        >
                          <td><TraceName trace={traceLabel} compact /></td>
                          <td>
                            <span
                              className={`judge-result-chip ${result.judge_provider ?? "unavailable"} ${result.judge_fallback_used ? "fallback" : ""}`}
                              title={[
                                result.judge_model_used ? `Model: ${result.judge_model_used}` : "",
                                result.judge_api_key_source
                                  ? formatJudgeApiKeySource(result.judge_api_key_source)
                                  : "",
                              ].filter(Boolean).join(" · ") || undefined}
                            >
                              {result.judge_provider
                                ? formatJudgeBackend(result.judge_provider, Boolean(result.judge_fallback_used))
                                : "n/a"}
                            </span>
                          </td>
                          <td>{result.error ? <span className="eval-pill error">error</span> : <span className={`eval-pill ${result.verdict}`}>{result.verdict}</span>}</td>
                          <td>
                            <button className="score-button" onClick={(event) => {
                              event.stopPropagation();
                              onToggleResult(result.trace_id);
                            }}>
                              {typeof result.score === "number" ? result.score.toFixed(1) : "n/a"}
                            </button>
                          </td>
                          <td>
                            <button className="score-button" onClick={(event) => {
                              event.stopPropagation();
                              onToggleResult(result.trace_id);
                            }}>
                              {typeof result.hallucination_score === "number" ? result.hallucination_score.toFixed(1) : "n/a"}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="eval-detail-row">
                            <td colSpan={5}>
                              <div className="eval-detail-content">
                                <div className="eval-result-actions">
                                  <button type="button" onClick={() => onOpenTrace(result.trace_id)}>Open trace</button>
                                  <button type="button" onClick={() => copyEvalReasoning(result)}>Copy reasoning</button>
                                </div>
                                <div className="eval-detail-metrics">
                                  <span><b>Verdict</b>{result.error ? "error" : result.verdict ?? "unknown"}</span>
                                  <span><b>Score</b>{typeof result.score === "number" ? result.score.toFixed(1) : "n/a"}</span>
                                  <span><b>Hallucination</b>{typeof result.hallucination_score === "number" ? result.hallucination_score.toFixed(1) : "n/a"}</span>
                                </div>
                                {result.judge_provider ? (
                                  <p className="eval-judge-note">
                                    <b>Judge:</b>{" "}
                                    {formatJudgeBackend(result.judge_provider, Boolean(result.judge_fallback_used))}
                                    {result.judge_model_used ? ` using ${result.judge_model_used}` : ""}
                                    {result.judge_api_key_source
                                      ? ` · ${formatJudgeApiKeySource(result.judge_api_key_source)}`
                                      : ""}
                                    {result.judge_service_tier ? ` · ${result.judge_service_tier} tier` : ""}
                                  </p>
                                ) : null}
                                <section className="eval-usage-section" aria-label="Usage">
                                  <h4 className="eval-subheading">Usage</h4>
                                  <div className="eval-detail-metrics">
                                    <InputUsageBlock
                                      variant="metric"
                                      uncachedTokens={result.uncached_input_tokens}
                                      uncachedCost={result.uncached_input_cost}
                                      cachedTokens={result.cached_tokens}
                                      cachedCost={result.cached_input_cost}
                                      cacheWriteTokens={result.cache_write_tokens}
                                      cacheWriteCost={result.cache_write_cost}
                                    />
                                    <UsageMetric label="Output" tokens={result.output_tokens} cost={result.output_cost} />
                                    <UsageMetric
                                      label="Reasoning"
                                      tokens={result.reasoning_tokens}
                                      cost={result.reasoning_cost}
                                    />
                                    <UsageMetric label="Total" tokens={result.total_tokens} cost={result.total_cost} />
                                  </div>
                                  {result.judge_usage ? (
                                    <InspectorSection title="Raw judge usage">
                                      <JsonExplorer value={result.judge_usage} initialDepth={2} />
                                    </InspectorSection>
                                  ) : null}
                                </section>
                                {result.trace_summary ? (
                                  <div className="eval-reasoning-block">
                                    <span>Trace Summary</span>
                                    <p>{result.trace_summary}</p>
                                  </div>
                                ) : null}
                                <div className={`eval-reasoning-block ${result.error ? "error" : ""}`}>
                                  <span>{result.error ? "Error" : "Reasoning"}</span>
                                  <p>{result.error ?? result.reasoning ?? "No reasoning provided."}</p>
                                </div>
                                {result.hallucination_reasoning ? (
                                  <div className="eval-reasoning-block">
                                    <span>Hallucination Review</span>
                                    <p>
                                      {typeof result.hallucination_score === "number"
                                        ? `${result.hallucination_score.toFixed(1)} · `
                                        : ""}
                                      {result.hallucination_reasoning}
                                    </p>
                                  </div>
                                ) : null}
                                {result.strengths?.length || result.issues?.length ? (
                                  <div className="eval-finding-columns">
                                    {result.strengths?.length ? (
                                      <div>
                                        <span>Strengths</span>
                                        <ul>
                                          {result.strengths.map((strength) => <li key={strength}>{strength}</li>)}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {result.issues?.length ? (
                                      <div>
                                        <span>Issues</span>
                                        <ul>
                                          {result.issues.map((issue) => <li key={issue}>{issue}</li>)}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>

        </section>

        {canRunPromptImprovement ? (
          <PromptImprovementCard
            running={promptImprovementRunning}
            result={promptImprovement}
            error={promptImprovementError}
            onRun={onRunPromptImprovement}
          />
        ) : null}
      </section>
    </>
  );
}

function PromptImprovementCard({
  running,
  result,
  error,
  onRun,
}: {
  running: boolean;
  result: PromptImprovementResult | null;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <section className="card prompt-optimizer-panel">
      <div className="section-title prompt-optimizer-hero">
        <div>
          <div className="eyebrow">Recommendations</div>
          <h3>Prompt optimization</h3>
          <p>
            Compare each current prompt with one proposed replacement, review the line diff, and see why the change
            was recommended.
          </p>
        </div>
        <button className="prompt-optimizer-button" disabled={running} onClick={onRun}>
          {running ? "Analyzing prompts..." : result ? "Refresh recommendations" : "Recommend improvements"}
        </button>
      </div>

      {error ? <div className="prompt-optimizer-error">{error}</div> : null}
      {result ? (
        <>
          <p className="eval-judge-note">
            <b>Judge:</b>{" "}
            {formatJudgeBackend(result.judge_provider, result.judge_fallback_used)}
            {` using ${result.judge_model_used}`}
            {result.judge_api_key_source
              ? ` · ${formatJudgeApiKeySource(result.judge_api_key_source)}`
              : ""}
            {result.judge_service_tier ? ` · ${result.judge_service_tier} tier` : ""}
          </p>
          <section className="eval-usage-section" aria-label="Usage">
            <h4 className="eval-subheading">Usage</h4>
            <div className="eval-detail-metrics prompt-optimizer-usage">
              <InputUsageBlock
                variant="metric"
                uncachedTokens={result.uncached_input_tokens}
                uncachedCost={result.uncached_input_cost}
                cachedTokens={result.cached_tokens}
                cachedCost={result.cached_input_cost}
                cacheWriteTokens={result.cache_write_tokens}
                cacheWriteCost={result.cache_write_cost}
              />
              <UsageMetric label="Output" tokens={result.output_tokens} cost={result.output_cost} />
              <UsageMetric
                label="Reasoning"
                tokens={result.reasoning_tokens}
                cost={result.reasoning_cost}
              />
              <UsageMetric label="Total" tokens={result.total_tokens} cost={result.total_cost} />
            </div>
            <InspectorSection title="Raw prompt-optimizer usage">
              <JsonExplorer value={result.judge_usage} initialDepth={2} />
            </InspectorSection>
          </section>
          <PromptImprovementReport result={result} />
        </>
      ) : null}
    </section>
  );
}

type PromptDiffLine = {
  kind: "context" | "added" | "removed" | "separator";
  text: string;
  oldLine?: number;
  newLine?: number;
};

function buildPromptDiff(originalPrompt: string, proposedPrompt: string) {
  const originalLines = originalPrompt.replace(/\r\n/g, "\n").split("\n");
  const proposedLines = proposedPrompt.replace(/\r\n/g, "\n").split("\n");
  const lcs = Array.from(
    { length: originalLines.length + 1 },
    () => new Uint32Array(proposedLines.length + 1),
  );

  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let proposedIndex = proposedLines.length - 1; proposedIndex >= 0; proposedIndex -= 1) {
      lcs[originalIndex][proposedIndex] = originalLines[originalIndex] === proposedLines[proposedIndex]
        ? lcs[originalIndex + 1][proposedIndex + 1] + 1
        : Math.max(lcs[originalIndex + 1][proposedIndex], lcs[originalIndex][proposedIndex + 1]);
    }
  }

  const lines: PromptDiffLine[] = [];
  let originalIndex = 0;
  let proposedIndex = 0;
  let oldLine = 1;
  let newLine = 1;

  while (originalIndex < originalLines.length || proposedIndex < proposedLines.length) {
    if (
      originalIndex < originalLines.length
      && proposedIndex < proposedLines.length
      && originalLines[originalIndex] === proposedLines[proposedIndex]
    ) {
      lines.push({
        kind: "context",
        text: originalLines[originalIndex],
        oldLine,
        newLine,
      });
      originalIndex += 1;
      proposedIndex += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (
      originalIndex < originalLines.length
      && (
        proposedIndex === proposedLines.length
        || lcs[originalIndex + 1][proposedIndex] >= lcs[originalIndex][proposedIndex + 1]
      )
    ) {
      lines.push({ kind: "removed", text: originalLines[originalIndex], oldLine });
      originalIndex += 1;
      oldLine += 1;
      continue;
    }

    lines.push({ kind: "added", text: proposedLines[proposedIndex], newLine });
    proposedIndex += 1;
    newLine += 1;
  }

  const changedIndexes = lines
    .map((line, index) => (line.kind === "added" || line.kind === "removed" ? index : -1))
    .filter((index) => index >= 0);
  if (!changedIndexes.length) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length - 1, index + 3);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.flatMap((range, index) => [
    ...(index ? [{ kind: "separator", text: "Unchanged lines hidden" } as PromptDiffLine] : []),
    ...lines.slice(range.start, range.end + 1),
  ]);
}

function PromptDiff({ originalPrompt, proposedPrompt }: {
  originalPrompt: string;
  proposedPrompt: string;
}) {
  const lines = useMemo(
    () => buildPromptDiff(originalPrompt, proposedPrompt),
    [originalPrompt, proposedPrompt],
  );

  if (!lines.length) {
    return <div className="prompt-diff-empty">The proposed prompt is identical to the current prompt.</div>;
  }

  return (
    <div className="prompt-diff" role="table" aria-label="Prompt line changes">
      {lines.map((line, index) => (
        line.kind === "separator" ? (
          <div className="prompt-diff-separator" key={`separator-${index}`}>{line.text}</div>
        ) : (
          <div className={`prompt-diff-line ${line.kind}`} key={`${line.kind}-${index}`}>
            <span className="prompt-diff-number">{line.oldLine ?? ""}</span>
            <span className="prompt-diff-number">{line.newLine ?? ""}</span>
            <span className="prompt-diff-marker">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            </span>
            <code>{line.text || " "}</code>
          </div>
        )
      ))}
    </div>
  );
}

function PromptChangeCard({ change }: { change: PromptImprovementChange }) {
  const [view, setView] = useState<"diff" | "original" | "proposed">("diff");
  const [copied, setCopied] = useState(false);

  const copyProposedPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(change.proposed_prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [change.proposed_prompt]);

  return (
    <article className="prompt-change-card">
      <div className="prompt-change-header">
        <div>
          <code>{change.target_file}</code>
          <h5>{change.target_agent}</h5>
          <span>{change.prompt_name}</span>
        </div>
        <button className="prompt-copy-button" type="button" onClick={copyProposedPrompt}>
          {copied ? "Copied" : "Copy new prompt"}
        </button>
      </div>

      <div className="prompt-version-tabs" role="group" aria-label="Prompt version view">
        {(["diff", "original", "proposed"] as const).map((option) => (
          <button
            className={view === option ? "active" : ""}
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
          >
            {option === "diff" ? "Changes" : option === "original" ? "Original prompt" : "New prompt"}
          </button>
        ))}
      </div>

      {view === "diff" ? (
        <PromptDiff originalPrompt={change.original_prompt} proposedPrompt={change.proposed_prompt} />
      ) : (
        <pre className="prompt-version-source">
          {view === "original" ? change.original_prompt : change.proposed_prompt}
        </pre>
      )}

      <div className="prompt-change-reasoning">
        <span>Why this changed</span>
        <p>{change.reasoning}</p>
      </div>
    </article>
  );
}

function PromptImprovementReport({ result }: { result: PromptImprovementResult }) {
  if (!result.prompt_changes.length) {
    return <div className="empty-state">No material prompt changes were recommended.</div>;
  }

  return (
    <div className="prompt-improvement-report">
      {result.prompt_changes.map((change, index) => (
        <PromptChangeCard
          change={change}
          key={`${change.target_file}-${change.prompt_name}-${index}`}
        />
      ))}
    </div>
  );
}

function SpanNodeView({
  node,
  depth,
  selected,
  selectedGuardrailEvent,
  collapsedNodes,
  guardrailEventBySpanId,
  timelineRange,
  onToggle,
  onSelect,
  onSelectGuardrailEvent,
  onPreviewAttachment,
}: {
  node: SpanNode;
  depth: number;
  selected?: string;
  selectedGuardrailEvent?: string;
  collapsedNodes: Set<string>;
  guardrailEventBySpanId: Map<string, TraceEvent>;
  timelineRange: TimelineRange | null;
  onToggle: (spanId: string) => void;
  onSelect: (span: SpanRecord) => void;
  onSelectGuardrailEvent: (event: TraceEvent) => void;
  onPreviewAttachment: (preview: AttachmentPreview) => void;
}) {
  const spanId = getSpanId(node.span);
  const kind = getSpanKind(node.span);
  const guardrailEvent = spanId ? guardrailEventBySpanId.get(spanId) : undefined;
  const guardrailEventIdentity = guardrailEvent ? getGuardrailEventIdentity(guardrailEvent) : undefined;
  const hasChildren = node.children.length > 0;
  const isCollapsed = Boolean(spanId && collapsedNodes.has(spanId));
  const attachments = getSpanAttachments(node.span);
  const firstAttachment = attachments[0];
  const attachmentPreview = firstAttachment ? createAttachmentPreview(firstAttachment, attachments, 0) : null;
  const triggered = guardrailEvent ? guardrailWasTriggered(guardrailEvent) : spanHasTriggeredGuardrail(node.span);
  const errored = Boolean(node.span.error);
  const isSelected = Boolean(spanId && selected === spanId)
    || Boolean(guardrailEventIdentity && selectedGuardrailEvent === guardrailEventIdentity);

  return (
    <div className="span-node" style={{ "--depth": depth } as CSSProperties}>
      <div className={`span-row ${isSelected ? "is-selected" : ""} ${guardrailEvent ? "has-guardrail-decision" : ""} ${triggered ? "is-triggered" : ""} ${errored ? "has-error" : ""}`}>
        <button
          className="collapse-toggle"
          disabled={!hasChildren || !spanId}
          onClick={() => spanId && onToggle(spanId)}
          aria-label={isCollapsed ? "Expand span" : "Collapse span"}
        >
          {hasChildren ? (isCollapsed ? "+" : "-") : ""}
        </button>
        <button
          aria-pressed={isSelected}
          className="span-main-button"
          onClick={() => guardrailEvent ? onSelectGuardrailEvent(guardrailEvent) : onSelect(node.span)}
        >
          <span className={`kind-badge ${kind}`}>{kind}</span>
          <span className="span-copy">
            <strong>
              {getSpanTitle(node.span)}
              {errored ? <span className="span-error-label">Error</span> : null}
            </strong>
            {guardrailEvent ? (
              <small title={getGuardrailEventSummary(guardrailEvent)}>{getGuardrailEventSummary(guardrailEvent)}</small>
            ) : (
              <small>
                {formatTime(node.span.started_at ?? node.span.start_time)} · {formatMs(getSpanDuration(node.span))}
              </small>
            )}
          </span>
          <span className="span-timeline" aria-hidden="true">
            <span className="timeline-duration">{formatMs(getSpanDuration(node.span))}</span>
            <span className="timeline-track">
              <span className={`timeline-bar ${kind}`} style={getTimelineBarStyle(node.span, timelineRange)} />
            </span>
          </span>
          {guardrailEvent ? (
            <span className={`guardrail-decision-pill ${triggered ? "is-triggered" : "is-passed"}`}>
              {triggered ? "Triggered" : "Passed"}
            </span>
          ) : (
            <span className="child-count">
              {node.children.length
                ? `${node.children.length} ${node.children.length === 1 ? "child" : "children"}`
                : ""}
            </span>
          )}
        </button>
        {attachments.length ? (
          attachmentPreview ? (
            <button
              className="span-attachment-button"
              onClick={() => onPreviewAttachment(attachmentPreview)}
              type="button"
              title={attachments.length === 1 ? getAttachmentLabel(firstAttachment) : `Browse ${attachments.length} attachments`}
              aria-label={attachments.length === 1 ? `Open ${getAttachmentLabel(firstAttachment)}` : `Browse ${attachments.length} attachments`}
            >
              <span className="attachment-file-icon" aria-hidden="true" />
              <span>{attachments.length}</span>
            </button>
          ) : (
            <span
              className="span-attachment-button is-disabled"
              title={`${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`}
              aria-label={`${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`}
            >
              <span className="attachment-file-icon" aria-hidden="true" />
              <span>{attachments.length}</span>
            </span>
          )
        ) : null}
      </div>
      {!isCollapsed
        ? node.children.map((child) => (
            <SpanNodeView
              key={getSpanId(child.span)}
              node={child}
              depth={depth + 1}
              selected={selected}
              selectedGuardrailEvent={selectedGuardrailEvent}
              collapsedNodes={collapsedNodes}
              guardrailEventBySpanId={guardrailEventBySpanId}
              timelineRange={timelineRange}
              onToggle={onToggle}
              onSelect={onSelect}
              onSelectGuardrailEvent={onSelectGuardrailEvent}
              onPreviewAttachment={onPreviewAttachment}
            />
          ))
        : null}
    </div>
  );
}

function TicketDetails({ ticket }: { ticket: FreshserviceTicket }) {
  return (
<div className="run-ticket-content">
                <dl className="it-property-grid run-ticket-properties">
                  <div><dt>Priority</dt><dd>{ticket.priority}</dd></div>
                  <div><dt>Classification</dt><dd>{ticket.classification || "Not classified"}</dd></div>
                  <div><dt>Category</dt><dd>{ticket.category}</dd></div>
                  <div><dt>Subcategory</dt><dd>{ticket.subcategory}</dd></div>
                  <div><dt>Platform</dt><dd>{ticket.platform || "Not assigned"}</dd></div>
                  <div><dt>Assigned group</dt><dd>{ticket.assigned_group_id || "Unassigned"}</dd></div>
                  <div><dt>Requester</dt><dd>{actorLabel(ticket.requester)}</dd></div>
                  <div><dt>Requester email</dt><dd>{ticket.requester.email || "Not recorded"}</dd></div>
                  <div><dt>Created</dt><dd>{formatDateTime(ticket.created_at)}</dd></div>
                  <div><dt>Tags</dt><dd>{ticket.tags.join(", ") || "None"}</dd></div>
                  <div className="is-wide"><dt>Description</dt><dd className="ticket-description">{ticket.description}</dd></div>
                </dl>
                <section className="run-ticket-notes">
                  <h4>Incident details</h4>
                  <dl className="it-property-grid">
                    <div><dt>Incident time</dt><dd>{ticket.incident.timestamp ? formatDateTime(ticket.incident.timestamp) : "Not supplied"}</dd></div>
                    <div><dt>Reported timezone</dt><dd>{ticket.incident.reported_timezone || "Not supplied"}</dd></div>
                    <div><dt>Affected customer</dt><dd>{ticket.incident.customer_id || "Not supplied"}</dd></div>
                    <div><dt>Affected member</dt><dd>{ticket.incident.member_id || "Not supplied"}</dd></div>
                    <div><dt>Affected person</dt><dd>{ticket.incident.customer_name || "Not supplied"}</dd></div>
                    <div><dt>Affected email</dt><dd>{ticket.incident.customer_email || "Not supplied"}</dd></div>
                  </dl>
                </section>
                {ticket.resolution ? (
                  <section className="run-ticket-notes">
                    <h4>Resolution</h4>
                    <p className="ticket-description">{ticket.resolution.summary}</p>
                    <dl className="it-property-grid">
                      <div><dt>Resolved by</dt><dd>{actorLabel(ticket.resolution.resolved_by)}</dd></div>
                      <div><dt>Outcome</dt><dd>{ticket.resolution.confirmation_outcome}</dd></div>
                      <div><dt>Resolved</dt><dd>{formatDateTime(ticket.resolution.resolved_at)}</dd></div>
                      <div><dt>Confirmed</dt><dd>{ticket.resolution.confirmed_at ? formatDateTime(ticket.resolution.confirmed_at) : "Not confirmed"}</dd></div>
                      <div><dt>Closed</dt><dd>{ticket.resolution.closed_at ? formatDateTime(ticket.resolution.closed_at) : "Not closed"}</dd></div>
                    </dl>
                  </section>
                ) : null}
                <section className="run-ticket-notes">
                  <h4>Private notes <span>({ticket.private_notes.length})</span></h4>
                  <div className="ticket-comment-list">
                    {ticket.private_notes.map((note, index) => (
                      <article key={`${note.timestamp}-${index}`} className="ticket-comment">
                        <div className="ticket-comment-heading"><strong>{actorLabel(note.author)}</strong><time>{formatDateTime(note.timestamp)}</time></div>
                        <PrivateNoteBody body={note.body} />
                      </article>
                    ))}
                    {!ticket.private_notes.length ? <p>No private notes have been added.</p> : null}
                  </div>
                </section>
                <section className="run-ticket-notes">
                  <h4>Conversations <span>({ticket.conversation.length})</span></h4>
                  <div className="run-email-thread">
                    {ticket.conversation.map((message, index) => (
                      <article className="run-email-message" key={`${message.timestamp}-${index}`}>
                        <header>
                          <div><strong>{message.direction === "inbound" ? "Inbound" : "Outbound"} · {message.from_address}</strong><span>to {message.to.join(", ") || "No recipient"}</span></div>
                          <time>{formatDateTime(message.timestamp)}</time>
                        </header>
                        <h5>{message.subject || "(No subject)"}</h5>
                        {message.cc.length ? <small>CC: {message.cc.join(", ")}</small> : null}
                        <p>{message.body}</p>
                      </article>
                    ))}
                    {!ticket.conversation.length ? <p>No conversation messages have been recorded.</p> : null}
                  </div>
                </section>
              </div>
  );
}
