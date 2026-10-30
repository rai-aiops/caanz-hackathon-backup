import type { FreshserviceTicket } from "./runtimeDataTypes";
import type { JsonRecord, SpanRecord, TraceRecord, TraceSummary } from "./types";

export type KpiMetric = {
  name: string;
  baseline: string;
  target: string;
  connected: boolean;
  value: string;
  note: string;
};
export type KpiData = {
  generated_at: string;
  ticket_count: number;
  completed_trace_count: number;
  running_trace_count: number;
  metrics: KpiMetric[];
};

function record(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function toolData(span: SpanRecord) {
  return record(span.span_data);
}

function successfulTool(span: SpanRecord, names: string[]) {
  const data = toolData(span);
  return data.type === "function" && names.includes(String(data.name))
    && !span.error && Boolean(span.ended_at ?? span.end_time)
    && data.output !== undefined && data.output !== null && data.output !== "";
}

const KNOWLEDGE_SOURCES = {
  freshservice_knowledge_base: "Freshservice knowledge base",
  confluence: "Confluence",
  ticket_history: "Ticket history",
  applications_support_keywords: "Applications support keywords",
} as const;
type KnowledgeSource = keyof typeof KNOWLEDGE_SOURCES;

function nonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Only inspect structured agent results, never prompts, tool inputs or retrieved content.
function reportedSources(value: unknown): Set<KnowledgeSource> | null {
  const output = record(value);
  if (!nonemptyText(output.ticket_id) || !nonemptyText(output.status) || !Array.isArray(output.sources_used)) return null;
  const sources = new Set<KnowledgeSource>();
  for (const source of output.sources_used) {
    if (typeof source !== "string" || !Object.hasOwn(KNOWLEDGE_SOURCES, source)) return null;
    sources.add(source as KnowledgeSource);
  }
  return sources;
}

function runSourceUsage(trace: TraceRecord): Set<KnowledgeSource> | null {
  const outputs: unknown[] = [record(record(trace.run_snapshot).result).workflow_output];
  for (const span of trace.spans) {
    if (span.error || !(span.ended_at ?? span.end_time)) continue;
    const data = toolData(span);
    if (data.type === "function" && [
      "freshservice_applications_assignment_agent", "applications_platform_detection_agent",
      "freshservice_confluence_knowledge_update_agent",
    ].includes(String(data.name))) outputs.push(data.output ?? span.output);
    const response = record(span.response ?? data.response);
    if (!Array.isArray(response.output)) continue;
    for (const item of response.output) {
      const message = record(item);
      if (message.type !== "message" || !Array.isArray(message.content)) continue;
      for (const content of message.content) {
        const part = record(content);
        if (part.type === "output_text") outputs.push(part.text);
      }
    }
  }
  let sources: Set<KnowledgeSource> | null = null;
  for (const output of outputs) {
    const reported = reportedSources(output);
    if (reported === null) continue;
    sources ??= new Set<KnowledgeSource>();
    for (const source of reported) sources.add(source);
  }
  return sources;
}

function elapsed(start: string | undefined, end: string | undefined) {
  const duration = Date.parse(end ?? "") - Date.parse(start ?? "");
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function meanDuration(values: number[]) {
  if (!values.length) return "No observations";
  const seconds = values.reduce((sum, value) => sum + value, 0) / values.length / 1000;
  return `${seconds.toFixed(0)} seconds`;
}

// Display-only observations. No inferred accuracy judgments or scenario expectations.
export function calculateKpis(
  tickets: FreshserviceTicket[],
  summaries: TraceSummary[],
  traces: TraceRecord[],
): KpiData {
  const completed = [...new Map(traces.filter((trace) => trace.status === "completed")
    .map((trace) => [trace.trace_id, trace])).values()];
  const ticketRuns = completed.filter((trace) => trace.spans.some((span) => {
    const data = toolData(span);
    return data.name === "lookup_ticket_data_tool" && typeof record(data.input ?? span.input).ticket_id === "string";
  }));
  const sourceReports = ticketRuns.map(runSourceUsage)
    .filter((sources): sources is Set<KnowledgeSource> => sources !== null);
  const unmeasuredRuns = ticketRuns.length - sourceReports.length;
  const routingTimes = ticketRuns.flatMap((trace) => {
    const endpoints = trace.spans.filter((span) => successfulTool(span, ["update_ticket_platform_tool"]))
      .map((span) => span.ended_at ?? span.end_time).filter((time): time is string => Boolean(time)).sort();
    const duration = elapsed(trace.started_at, endpoints[0]);
    return duration === null ? [] : [duration];
  });
  const ticketRunIds = new Set(ticketRuns.map((trace) => trace.trace_id));
  const costRuns = summaries.filter((summary) => ticketRunIds.has(summary.trace_id)
    && summary.status === "completed" && Number.isFinite(summary.total_cost)
    && summary.total_cost >= 0 && (summary.cost_source === "cost_summary" || summary.total_tokens > 0));
  const estimatedCosts = costRuns.filter((summary) => summary.cost_source !== "cost_summary").length;
  const unspecified = "Not specified";
  return {
    generated_at: new Date().toISOString(),
    ticket_count: tickets.length,
    completed_trace_count: completed.length,
    running_trace_count: summaries.filter((summary) => summary.status === "running").length,
    metrics: [
      {
        name: "Average Resolution Time", baseline: unspecified, target: unspecified, connected: false,
        value: "Not measured",
        note: "Requires observed ticket creation and human resolution times, plus change linkage to exclude tickets with associated changes as specified by the PRD. Synthetic fixture and scenario timestamps do not measure resolution time.",
      },
      {
        name: "Applications Team Active Time", baseline: unspecified, target: unspecified, connected: false,
        value: "Not measured",
        note: "Requires human work sessions or time entries for the Applications team. Model execution duration does not measure team effort.",
      },
      {
        name: "Customer Satisfaction", baseline: unspecified, target: unspecified, connected: false,
        value: "Not measured",
        note: "Requires customer survey responses and a defined satisfaction scale. Resolution confirmation alone is not a satisfaction score.",
      },
      ...Object.entries(KNOWLEDGE_SOURCES).map(([source, label]): KpiMetric => {
        const usedRuns = sourceReports.filter((sources) => sources.has(source as KnowledgeSource)).length;
        return {
          name: `Knowledge Utilization · ${label}`, baseline: unspecified, target: unspecified, connected: true,
          value: sourceReports.length ? `${Math.round(usedRuns / sourceReports.length * 100)}% (${usedRuns}/${sourceReports.length})` : "No observations",
          note: `Agent-reported meaningful contribution: ended ticket runs reporting use of ${label}, divided by ended ticket runs with structured source reporting. Each source counts once per run across all agents and payloads; rates need not sum to 100%. ${sourceReports.length}/${ticketRuns.length} ended ticket runs have reporting; ${unmeasuredRuns} unmeasured runs are excluded, not treated as zero use. Empty source lists count as reported non-use. Lookups alone, empty results and irrelevant matches do not count. Includes observed reports before workflow failure; decisions that never produced a report remain unknown. This is self-reported contribution, not independently verified evidence quality.`,
        };
      }),
      {
        name: "Ticket Routing Time", baseline: "~15 minutes", target: unspecified, connected: true,
        value: meanDuration(routingTimes),
        note: `Proxy: trace start to first completed platform-routing tool call without an error; ${routingTimes.length}/${ticketRuns.length} ended ticket runs have valid intervals. Classification alone is not routing. Includes time between payloads, excludes time before workflow launch and unrouted runs. The PRD baseline is not directly comparable to this workflow-only interval.`,
      },
      {
        name: "Cost Per Ticket", baseline: unspecified, target: unspecified, connected: true,
        value: costRuns.length ? `$${(costRuns.reduce((sum, summary) => sum + summary.total_cost, 0) / costRuns.length).toFixed(4)} / run` : "No observations",
        note: `Proxy: mean recorded model/tool cost per ended ticket run with cost evidence (${costRuns.length} runs; ${estimatedCosts} use visible-span estimates). Includes failed runs and all payloads in each run. Repeated runs count separately. Excludes human effort, infrastructure and unrecorded costs; not total service cost per ticket. Currency follows trace pricing in USD.`,
      },
      {
        name: "Detection Accuracy (Evaluation Measure)", baseline: unspecified, target: "95%", connected: false,
        value: "Not measured",
        note: "Requires independently validated expected and actual platform/classification decisions over a defined evaluation cohort. Assignment counts, model confidence and generic judge scores do not establish detection accuracy.",
      },
      {
        name: "Incomplete Ticket Handling", baseline: unspecified, target: "95%", connected: false,
        value: "Not measured",
        note: "Requires the incident facts at intake plus a validated handling outcome for each incomplete ticket. Current tickets may already include requester updates. Reply counts alone do not show that the correct missing facts were requested or handled successfully.",
      },
    ],
  };
}
