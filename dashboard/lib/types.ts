export type JsonRecord = Record<string, unknown>;

export type TraceAttachment = JsonRecord & {
  id?: string;
  kind?: string;
  label?: string;
  source_path?: string;
  source_pdf_path?: string;
  source_file_path?: string;
  file_path?: string;
  source_file_name?: string;
  source_pdf_name?: string;
  page_number?: number;
  mime_type?: string;
  sha256?: string;
  original_image_chars?: number;
  preview_url?: string;
};

export type SpanRecord = JsonRecord & {
  id?: string;
  span_id?: string;
  trace_id?: string;
  parent_id?: string | null;
  started_at?: string;
  ended_at?: string;
  start_time?: string;
  end_time?: string;
  name?: string;
  type?: string;
  span_data?: unknown;
  input?: unknown;
  output?: unknown;
  response?: unknown;
  error?: unknown;
  trace_attachments?: TraceAttachment[];
};

export type TraceEvent = JsonRecord & {
  type: string;
  timestamp?: string;
  trace_id?: string;
  source?: string;
  trace?: JsonRecord;
  span?: SpanRecord;
  agent_name?: string;
  tool_name?: string;
  guardrail_name?: string;
  guardrail_scope?: string;
  guardrail_stage?: string;
  passed?: boolean;
  triggered?: boolean;
  output_info?: unknown;
};

export type TraceRecord = {
  trace_id: string;
  workflow_name?: string;
  status: "running" | "completed";
  started_at?: string;
  ended_at?: string;
  updated_at?: string;
  trace?: JsonRecord;
  run_snapshot?: JsonRecord;
  events: TraceEvent[];
  spans: SpanRecord[];
};

export type TraceSummary = {
  trace_id: string;
  workflow_name?: string;
  status: "running" | "completed";
  started_at?: string;
  ended_at?: string;
  updated_at?: string;
  duration_ms?: number;
  event_count: number;
  span_count: number;
  agent_count: number;
  tool_count: number;
  guardrail_count: number;
  error_count: number;
  total_tokens: number;
  total_cost: number;
  cost_source?: "cost_summary" | "span_estimate";
  span_visible_tokens?: number;
  span_visible_cost?: number;
  model_cost?: number;
  tool_cost?: number;
  unattributed_cost?: number;
};
