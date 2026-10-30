# Local Workflow Dashboard

The dashboard is the participant-facing control and observability UI for the
CAANZ prototype. It is a Next.js 16 / React 19 application with five views:

| View | Use it for |
| --- | --- |
| **Runs** | Run saved scenarios and inspect the addressed ticket, private notes and conversations |
| **Traces** | Browse local run summaries, spans, tool calls, usage, and errors |
| **Evals** | Judge selected traces, add evaluation context, and generate prompt recommendations |
| **Data** | Inspect Freshservice tickets/KB and Confluence documents, including architecture pages and review drafts |
| **KPIs** | Review PRD business KPIs with four source-specific knowledge utilization rates, connected proxies and measurement gaps |

Selecting a trace in the left sidebar opens that trace's detailed view on the
Traces tab. The sidebar's Edit mode selects runs for deletion separately.
See [Runs](#runs-view) for scenario controls and ticket inspection.

## Quick start

Install once:

```bash
cd dashboard
npm install
```

Use Node.js 20.9 or newer. Run npm commands from `dashboard/`; runtime file
readers resolve `../data/runtime` from that working directory. The Python service
requires Python 3.14+, `uv sync`, macOS/Linux or Windows and a configured
`OPENAI_API_KEY`, including at import time.

For the full dashboard experience, run both services.

Terminal 1, from the repository root:

```bash
uv run python api.py
```

Terminal 2:

```bash
cd dashboard
npm run dev
```

Open `http://localhost:3100`.

The Runs view requires FastAPI at `http://127.0.0.1:8000` by default. Trace
review alone does not: a CLI workflow can still post events directly to the
dashboard while it is running.

## Runs view

Runs supports saved scenarios only. The scenario selector loads IDs, descriptions
and ordered payload previews through `GET /api/scenarios` → FastAPI `GET /scenarios`.
The payload preview is read-only and collapsible; there is no custom-payload mode.

**Reset context & run scenario** sends the chosen `scenario_id` through
`POST /api/scenarios/run` → FastAPI `/scenarios/run/stream`. The API validates
all payloads, restores baseline fixtures once, and runs them in one session and
trace. Routing, waiting and manual review allow later external events; a failed
output or exception stops the sequence. SSE heartbeats keep the connection alive
until a result or error. No separate tool-progress events are sent on this stream.

The backend has prompt-injection and 90% confidence guardrails. Tripwires stop
the sequence and appear as SSE errors: 422 for Manager-input injection, 409 for
tool-content injection or confidence. Confidence errors require human review;
they do not save a Manual Review status or notify an admin. Earlier writes remain
saved. PII checks are deferred. See [guardrail contracts](guardrails.md).

While a scenario runs, Runs polls `/api/runs/context?ticket_id=FS-...` every 750 ms.
The proxy accepts only a Freshservice ticket ID and forwards it to the current
FastAPI context endpoint. The ticket card shows subject, status, routing,
requester and affected-person details, incident facts, tags, resolution, all
private notes and all inbound/outbound conversations. Fenced log excerpts in
private notes render as code blocks, preserving whitespace and allowing horizontal
scrolling. Author, sender, recipient
and message timestamps are retained. Scenario event timestamps are generated
when each payload is applied; previews omit them. There is no separate email-thread
panel or standalone email ID. The header keeps workflow status and ticket ID;
Mode/Email and the Input/Target/Queue boxes have been removed.

The final typed API ticket is saved in a local run snapshot so selecting an older
run shows its saved state, rather than a later runtime ticket. For older traces
without a saved ticket, Runs reconstructs the workflow outcome and loads the
matching current local ticket by ID. A notice distinguishes that current state
from the unavailable final historical snapshot. Context lookup errors are shown
in the ticket card. A late response from another selection is ignored.

**Reset context** separately restores baseline fixtures, discards runtime changes
and clears the displayed run. It asks for confirmation. Reset and run controls
are disabled during execution. Browser run preferences use version 3 storage;
version 2 state remains readable, with custom-payload preferences discarded.

Workflow proxies allow up to 30 minutes. Model-backed scenarios require
`OPENAI_API_KEY`. Reads, scenario previews and resets do not call models. Direct structured triggers and custom scenario payloads remain available through
FastAPI. The retained custom-scenario proxy is not used by Runs.

Saved-scenario payloads advance automatically. There are no per-payload approval
buttons, requester-email editor or explicit Stop control. Closing a backend SSE
stream cancels its pending task, but the Next.js proxy has no explicit
cancellation forwarding, so closing a browser tab is not a guaranteed stop.
Inspect current records and the trace after an interruption; successful writes
remain saved.

## Traces and events

Python's `TelemetryRunHook` sends best-effort events to
`http://localhost:3100/api/events` by default. The dashboard writes ingested
records under the ignored `dashboard/.local_traces/` directory and publishes
live events to the UI over its own event stream.

```bash
LOCAL_OBSERVABILITY_URL=http://localhost:3100/api/events uv run python main.py
```

Disable Python event posting with:

```bash
LOCAL_OBSERVABILITY_ENABLED=0 uv run python main.py
```

If the dashboard is unavailable, telemetry posting is ignored and the Python
workflow continues. Python also writes its own trace bundles under the
repository's ignored `traces_logs/` directory; the dashboard reads those when
building trace views alongside dashboard-ingested events.

Deleting selected runs asks for confirmation and removes both the dashboard's
local record and matching Python trace bundle. Runtime ticket records are separate.

Heartbeat and connection events keep streams alive but are filtered from the
main trace/event presentation so they do not overwhelm the useful spans.

Guardrail spans in the trace timeline are paired with their local decision
events. Each matching row shows the pass/trigger state and a short explanation;
selecting it opens the complete structured `output_info` in the inspector.
Guarded tool arguments remain available in a separate collapsed inspector
section because they can contain requester or ticket content.

## Data view

The Data view reads the current local CAANZ JSON fixtures through the read-only
Next.js `GET /api/runtime/data` route. It has three tabs:

- **Freshservice tickets**: `freshservice_tickets.json`, including current and
  historical records, routing, requester/incident details, resolution, all private
  notes and embedded conversations. The detail renderer is shared with Runs.
- **Freshservice KB**: `freshservice_kb.json`, including full article text,
  version, status, owner group, platforms, process IDs and tags.
- **Confluence documents**: `confluence_dependency_map.json`,
  `confluence_access_layer.json` and every page in `confluence_kb.json`, including
  published process documentation and saved review drafts. Document type, status,
  version, author and available dates are displayed. Null dates are not invented.

Confluence documents and Freshservice articles render Markdown headings, nested
bulleted/numbered lists, bold and italic text, links, tables, blockquotes and code
blocks. Code blocks preserve whitespace and scroll horizontally; wide tables
scroll within the document. Links open in a new tab. Raw HTML is ignored.
The shared renderer uses `react-markdown` with `remark-gfm`; its styles follow
the dashboard's light/dark theme.

On wider screens, the browse and detail cards share a height and align at the
top and bottom, with independent scrolling. Narrow screens stack the cards and
cap the browse list while allowing the detail content to grow.

All files are read from `data/runtime/`. Filter buttons select ticket status or document publication status. Confluence
also filters by dependency map, Access Layer or knowledge base; both filters
combine. Buttons show counts within the other active filter. Each tab remembers
its status filter, and All clears that filter. Search inputs are removed.
Refresh rereads the files and workflow events also refresh the view. There is no
baseline fallback, automatic reset, editing, publishing or model call. Missing
files and invalid JSON produce explicit errors; a failed refresh labels retained
records as previously loaded. `GET /api/tickets` returns the same current
Freshservice ticket records, without legacy ticket/update wrappers.

## FastAPI proxy routes

Browser code calls local Next.js routes; secret-bearing and filesystem work
stays on the server. The workflow proxies use
`LOCAL_AGENTS_API_BASE_URL`, defaulting to `http://127.0.0.1:8000`.

| Dashboard route | FastAPI route |
| --- | --- |
| `POST /api/scenarios/run/custom` | `POST /scenarios/run/custom/stream` |
| `GET /api/scenarios` | `GET /scenarios` |
| `POST /api/scenarios/run` | `POST /scenarios/run/stream` |
| `GET /api/runs/context` | `GET /runs/context` |
| `POST /api/runtime/reset` | `POST /runtime/reset` |

Set a different origin before starting Next.js:

```bash
LOCAL_AGENTS_API_BASE_URL=http://127.0.0.1:9000 npm run dev
```

Other routes operate locally in Next.js:

| Route | Purpose |
| --- | --- |
| `GET /api/traces`, `GET/PUT/DELETE /api/traces/[traceId]` | List/inspect traces, save a final run snapshot or delete local records/bundles |
| `POST /api/events`, `GET /api/events/stream` | Ingest Python events and stream dashboard events |
| `GET /api/runtime/data`, `GET /api/tickets` | Read current local fixture data |
| `GET /api/kpis` | Compute local KPI observations and measurement gaps |
| `GET /api/attachments/preview` | Preview a repository file by `path`; PDF rendering uses local Python/PyMuPDF |
| `GET /api/openai/models` | Discover judge models through the configured backend/fallback list |
| `GET/PUT /api/evals/judge-prompt` | Read or save the editable judge prompt |
| `GET/POST/DELETE /api/evals/context` | Inspect, add or clear uploaded evaluation context |
| `POST /api/evals/run` | Evaluate selected traces with the configured remote judge |
| `POST /api/evals/prompt-improvements` | Generate prompt recommendations from evaluation results |

These are implementation routes, not additional FastAPI workflow endpoints.
Direct-email and approval proxies are absent. Local file and workflow operations
have no application authentication layer; this is a local prototype.

## Evals view

The Evals view lets participants select local traces and judge workflow
quality with a structured Responses API request.
Evaluations and prompt recommendations default to `openai/gpt-6.1-sol`.

### Judge backend

The dashboard first tries a LiteLLM-compatible endpoint:

| Variable | Default / use |
| --- | --- |
| `LITELLM_PROXY_BASE_URL` | `http://localhost:4000` |
| `LITELLM_PROXY_API_KEY` | Optional proxy key; otherwise the available OpenAI key or local placeholder is used |

If the LiteLLM fetch throws a connection/transport error and an OpenAI credential
is available, the judge falls back to OpenAI. An HTTP error response from the
proxy is returned as an evaluation error without this fallback. Credential
preference is:

1. `DASHBOARD_OPENAI_API_KEY`
2. `OPENAI_API_KEY`

The UI identifies the selected backend and key source without exposing the
credential. Dashboard environment values may be placed in the process
environment, `dashboard/.env.local`, `dashboard/.env`, `.env.agents`, or the
repository root `.env`.

LiteLLM usage is recorded when the proxy returns it, but calculated costs stay
`n/a` because proxy pricing is deployment-specific. For recognized direct
OpenAI models, results include normalized input, cached/uncached input, cache
write, output, reasoning, total tokens, raw usage, and estimated costs.
Estimates use the checked-in pricing tables in `utils.py`, `lib/traceStore.ts`
and `lib/evalJudge.ts`; they are not live billing quotes. Older models and Code
Interpreter also retain approximate estimates. `openai/gpt-6.1-terra` is included
in the judge selector and fallback model list. Its configured standard rates per
million tokens are $1 input, $0.05 cached input, $1.25 cache write and $5 output.
Python telemetry, trace estimates and direct judge costs include configured
Flex/Fast and long-context rates. All four workflow agents use `gpt-6.1-terra`;
the judge defaults separately to `openai/gpt-6.1-sol`.
Direct judge costs use standard, Flex or Priority/Fast rates when configured in
the pricing table. Python telemetry and trace estimates also apply service-tier
multipliers for GPT-6/GPT-6.1 and GPT-5.6: Flex is 0.5×, and Priority/Fast is 2×.
GPT-6 Astra and GPT-6.1 Sol also support 6× Ultrafast pricing.
Missing or unrecognized tiers use standard rates in Python and trace estimates. These combine with long-context
multipliers above 272,000 input tokens for eligible models: 2× for input,
cached input and cache writes, and 1.5× for output. Reasoning tokens are a subset
of output tokens and are not charged twice.

### Judge input and compaction

The evaluator builds current source context from `main.py`, `tools/`, and
`guardrails/`. It excludes `custom_agents/` source because the executed agent
instructions, tool descriptions, and outputs are already present in the
trace.

Before evaluation, repeated stable response instructions, tools, text, and
configuration are replaced with references when that representation is
smaller. Encrypted reasoning and recorded workflow usage/cost telemetry are
removed from the evaluation copy. Identity, timing, status, errors, outputs,
and conversation-chain fields remain. Compaction counts are sent under
`eval_compaction`; the saved trace itself is never modified.

GPT-6/GPT-6.1 and GPT-5.6 judge calls use an explicit cache breakpoint after the
stable judge prompt, added context, non-agent source context, schema, and evaluation
framing. Trace JSON is sent after that breakpoint and is excluded from cache
writes. The cache key changes when the stable judge context changes.

### Prompt and added context

- Editable prompt: `dashboard/prompts/judge-prompt.md`
- Built-in default: `dashboard/prompts/default-judge-prompt.md`
- Uploaded/generated context: ignored `dashboard/context/`

The judge assesses supplied criteria explicitly and separates specification
conflicts from agent errors without assuming additional criteria exist.

**Revert changes** reloads the saved editable prompt. **Use default** loads the
default into the editor. Only **Save prompt** writes to disk.

**Add context** accepts PDFs and text-like files such as Markdown, JSON, CSV,
source code, logs, HTML, XML, and YAML. Text is capped at 120,000 characters
per file. PDF extraction records page and embedded-image counts and includes
extracted text; embedded images are detected but are not visually sent to the
judge. Unsupported/image-only files contribute a manifest note rather than
visual content. **Clear context** removes the generated context directory.

After evaluation, **Export HTML report** downloads a standalone, print-friendly
report with aggregate results, every trace evaluation, and generated prompt
recommendations/diffs.

Prompt recommendations include proposed agent prompt changes; generating or
exporting them does not edit `custom_agents/`. Recommendation generation uses
current agent source as well as runner/tool/guardrail source and judge results;
it omits full traces. To assess CAANZ scenario expectations, explicitly add the
relevant criteria or `data/scenarios.json` as judge context: the default source
context does not load scenario expectations automatically. A generic judge pass
does not establish that every catalog assertion or PRD KPI passed.

## Local and generated state

Do not commit these directories:

- `dashboard/.local_traces/` — ingested local trace/event records
- `dashboard/context/` — uploaded and generated eval context
- `dashboard/.next/` — Next.js build output
- `dashboard/node_modules/` — installed dependencies

The browser also stores draft run state and the most recent eval results in
local storage. Those results survive refresh until another eval begins or the
relevant context is cleared.

## Development commands

```bash
cd dashboard
npm run typecheck
npm run build
npm run start
```

`npm run start` serves a completed production build on port 3100.

## Troubleshooting

- **Could not reach the local agents API:** verify
  `http://127.0.0.1:8000/` returns `{"service":"caanz-workflow-service","status":"ok"}`.
  If FastAPI uses another origin, set `LOCAL_AGENTS_API_BASE_URL` before
  starting Next.js.
- **The workflow says waiting:** the Manager saved a missing-information reply
  to the local ticket conversation. A later `requester_update` trigger can resume
  investigation after the requester supplies the missing facts. There is no
  human-approval endpoint.
- **A follow-up starts the wrong request:** include the existing ticket ID.
  Displayed context is not automatically substituted into an arbitrary API
  request.
- **Trace data is missing:** start the dashboard before the run and verify
  `LOCAL_OBSERVABILITY_URL`; telemetry posting is best effort.
- **Runtime data reverted:** scenario runs and Reset context restore
  `data/runtime/` from `data/store/`. API startup and reload do not reset it.
- **An eval cannot use an uploaded image:** current added-context processing
  extracts PDF/text content but does not send image pixels to the judge.

## KPIs view

KPIs follows section 1.3 of `docs/reference/Agentic Prototype PRD - CAANZ.docx`.
The PRD supplies a ~15 minute routing baseline and 95% targets for Detection
Accuracy and Incomplete Ticket Handling; its other baseline/target cells are
blank and display as **Not specified**.

`GET /api/kpis` reads current tickets through the existing runtime reader and
reconciled local/historical traces through the trace store. It performs no
model calls, resets or writes and requires no FastAPI service or API key.
The page refreshes every 10 seconds, on runtime revision and by its Refresh
KPIs button. Filters show all 11 rows (the eight PRD KPIs with Knowledge
Utilization split into four resources), connected proxies or measurement gaps.
Errors preserve the previous values with a stale-data notice.

Connected proxies show their definitions and denominators in expandable
measurement details:

- Knowledge Utilization has separate rows for Freshservice knowledge base,
  Confluence, ticket history and applications support keywords. Each rate is
  **ended ticket runs reporting meaningful use of that source / ended ticket runs
  with structured source reporting × 100**. The table shows the numerator and
  denominator, plus reporting coverage and excluded unmeasured runs in details.
  It reads validated `sources_used` entries from structured specialist tool
  results, agent response messages and saved Manager output. It never infers
  contribution from tool calls, inputs or retrieved content. Each source counts
  once per trace across all agents, repeated lookups and ordered payloads;
  percentages can overlap. Confluence includes dependency-map, Access Layer and
  process documentation. Reports contain source literals only.
  Explicit empty lists count as reported non-use. Legacy/missing/malformed
  reports are unknown and excluded when no valid report exists for that run;
  no observations displays **No observations**, not zero. Ended failures with
  reports contribute observed source use, while decisions without a report
  remain unknown. Agent claims measure reported contribution, not independently
  verified usefulness. Merely looking up a resource or receiving an empty or
  irrelevant result does not count.
- Ticket Routing Time: mean trace-start-to-first-platform-write interval among
  ended ticket runs with a completed routing call without a tool error.
  Classification alone does not count. Pre-launch time and unrouted runs are
  excluded; requester waiting between payloads is included.
- Cost Per Ticket: mean recorded model/tool cost per ended ticket run with cost
  evidence, including failures. Visible-span estimates are identified. This is
  a per-run proxy, not a full service cost or deduplicated cost per unique ticket.

Running traces are excluded. Trace completion means recording ended, not
workflow success. Repeated runs count separately; traces persist across runtime
resets while current ticket observations are replaced. Invalid/reversed time
intervals and missing cost observations do not become zero values.

Average Resolution Time remains **Not measured**. Synthetic fixture and scenario
timestamps are not used to calculate it. It requires observed creation and human
resolution times and change linkage to isolate tickets without associated changes.

Applications Team Active Time and Customer Satisfaction need human time entries
and survey records. Detection Accuracy needs validated decisions and independent
expected results; model confidence and generic judge scores are not substitutes.
Incomplete Ticket Handling needs intake-state evidence and validated outcomes,
which cannot be reconstructed reliably from updated current tickets or reply
counts. Together with Average Resolution Time, these five KPIs display
**Not measured**, with no invented scores.
