# CAANZ Applications Triage Prototype

CAANZ classifies Freshservice tickets, investigates application-platform evidence,
routes tickets, requests missing incident facts and recommends knowledge updates.
Its four agents use local tools backed by synthetic Freshservice, Confluence and
Boomi fixtures. Humans retain root-cause analysis, remediation, ticket closure
and publication of knowledge recommendations.

The Manager coordinates Applications Assignment, Platform Detection and Knowledge
Update. The dashboard provides scenario runs, traces, evaluations, current data
and KPIs. Prompt-injection and confidence checks apply at the boundaries described
in the [guardrail guide](docs/guardrails.md).

## Quick start

Requirements: Python 3.14 or newer, `uv`, Node.js 20.9 or newer and npm.
Local fixture locking supports macOS, Linux and Windows.

From the repository root, install dependencies:

```bash
uv sync
(cd dashboard && npm install)
```

Create an ignored root `.env` file containing your API key:

```dotenv
OPENAI_API_KEY=your-key-here
```

The key is required for Python imports, scenario listing and model execution.
Your account must have access to the [configured models](#agents-models-and-limits).
Keep credentials out of commits. Model-backed workflows and evaluations incur API
usage.

Start the API and dashboard in separate terminals:

```bash
uv run python api.py
```

```bash
cd dashboard && npm run dev
```

Open [the dashboard](http://localhost:3100), select `happy_path` in Runs and choose
**Reset context & run scenario**. This restores baseline fixtures and runs the
ordered events, including scripted human outcomes. Inspect the ticket's notes and
conversation, then its trace. See the [Runs guide](docs/dashboard.md#runs-view)
for run controls and the [dashboard guide](docs/dashboard.md) for each view.

## How a scenario flows through the system

For example, `happy_path` follows an employment-history update failure on ticket
FS-1001 through triage and knowledge review:

1. The dashboard sends the selected scenario to FastAPI through its Next.js
   proxy. FastAPI validates the payloads and restores baseline fixtures once.
2. The shared runner dispatches `new_ticket`. The Manager reads FS-1001 and calls
   Assignment to classify it as Application Support, then saves its findings.
3. Detection reads the architecture and process documentation, correlates Boomi
   logs with the incident time and affected member, and uses the Salesforce
   boundary error to support platform-team routing. The Manager saves the
   investigation findings and log excerpts.
4. The runner applies the next payload's scripted human resolution and requester
   confirmation, then dispatches `resolution_confirmed` for the same ticket.
5. The Manager calls Knowledge to review support guidance and dependency mappings.
   Any recommendations are saved as private notes or review drafts before their
   tags are applied; outcome tags include `AI` and `resolved`.
6. The API returns the final Manager output and saved ticket. Both payloads share
   one session and trace, which the dashboard makes available for inspection.

See the [scenario catalog](docs/scenarios.md) for expected outcomes and recorded results.

## Run from the CLI

```bash
uv run python main.py --list_scenarios
uv run python main.py --scenario happy_path
uv run python main.py --scenario all
```

The default scenario is `happy_path`. Each selected scenario starts from restored
fixtures; `all` restores before each scenario. Listing preserves runtime. Failed
runs return a nonzero exit status. See the [scenario catalog](docs/scenarios.md) for
cases, expected results and recorded evaluations, and
[data lifecycle](docs/data.md#validation-and-resets) for manual resets and shared
state across payloads.

## Local API

The FastAPI service accepts structured triggers and saved/custom scenarios through
the shared runner. Run one API worker against the shared fixtures. For development
with reload, use `uv run uvicorn api:app --reload`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/` | Health check |
| GET | `/scenarios` | Scenario IDs, descriptions and payload previews |
| POST | `/agents/run` | Run one trigger against current runtime |
| POST | `/scenarios/run` | Validate a saved scenario, restore fixtures once, then run its payloads |
| POST | `/scenarios/run/custom` | Validate custom payloads for one baseline ticket, restore once, then run them |
| GET | `/runs/context?ticket_id=FS-1001` | Current ticket, notes and conversation |
| POST | `/runtime/reset` | Restore baseline fixtures, discarding runtime changes |

Each run route also has a `/stream` variant. For example:

```bash
curl -N -X POST http://localhost:8000/scenarios/run/stream \
  -H 'Content-Type: application/json' \
  -d '{"scenario_id":"missing_timestamp_then_reply"}'
```

Direct `/agents/run` requests use `trigger_type` and `ticket_id`, with optional
trusted updates. Initialize runtime with `/runtime/reset` before the first direct
run. Custom scenarios use `{"payloads":[...]}`. See
[event contracts](docs/data.md#scenario-events-and-updates) for trigger types,
requester email and ticket-update formats, and
[interactive API docs](http://localhost:8000/docs) for request/response schemas.

Responses include `ManagerOutput`, the persisted ticket with its conversation,
and trace/session identifiers. Workflow outcomes and saved actions are defined
in the [agent output contracts](docs/agents.md#structured-outputs).

Invalid requests return 422, unknown tickets/scenarios 404, overlapping API
runs/resets 409, and execution/storage failures 500. Guardrail failures follow the
[tripwire mappings](docs/guardrails.md#api-and-observability). A typed Manager
`failed` output returns HTTP 200; inspect the workflow result.

Streaming emits `connected`, a `heartbeat` every 15 seconds, then `result` or
`error`. Validation may fail before the stream opens. Errors after opening arrive
on the HTTP 200 stream with `status_code` in the event; clients must inspect the
event. Earlier successful writes remain saved after a failure.

## Agents, models and limits

The Manager and three specialists use `gpt-6.1-terra`, configured in their agent
factories. Manager runs and each specialist call have a 50-turn limit. See
[agent responsibilities](docs/agents.md) for procedures and tool ownership.

Dashboard evaluations and prompt recommendations default to `openai/gpt-6.1-sol`.
See [judge configuration](docs/dashboard.md#judge-backend) for model selection,
LiteLLM and OpenAI credentials.

## Configuration reference

Python loads the root `.env`. Optional runtime settings are:

| Variable | Purpose / default |
| --- | --- |
| `LOCAL_OBSERVABILITY_URL` | Telemetry event destination; `http://localhost:3100/api/events` |
| `LOCAL_OBSERVABILITY_ENABLED` | Set to `0`, `false` or `no` to disable best-effort telemetry posts |
| `LOCAL_AGENTS_API_BASE_URL` | Dashboard's FastAPI origin; `http://127.0.0.1:8000` |

Set the API origin in the Next.js process environment or dashboard env file when
using a different backend address; see
[dashboard proxy configuration](docs/dashboard.md#fastapi-proxy-routes).
Evaluation credentials and environment-file lookup are documented in the
[judge backend guide](docs/dashboard.md#judge-backend).

## Repository and guides

| Path | Responsibility / guide |
| --- | --- |
| `main.py`, `api.py` | Shared runner, CLI and HTTP/SSE service |
| [docs/](docs/) | Project guides and source reference material |
| [custom_agents/](docs/agents.md) | Agent prompts, factories, procedures and typed outputs |
| [tools/](docs/tools.md) | Local tool inputs, results, searches and persistence |
| [guardrails/](docs/guardrails.md) | Active checks, thresholds and stopping behavior |
| [data/](docs/data.md) | Baselines, mutable runtime, reference evidence and event formats |
| [scenario catalog](docs/scenarios.md) | Scenario coverage, expected outcomes and recorded evaluations |
| [dashboard/](docs/dashboard.md) | Runs, Traces, Evals, Data, KPIs and dashboard configuration |
| `utils.py`, `traces_logs/` | Telemetry/tracing utilities and ignored Python trace bundles |

Additional documentation: [system requirements](docs/system-requirements.md),
[synthetic data guide](docs/synthetic-data-guide.md),
[contributor instructions](docs/contributing.md) and [project tasks](docs/todo.md).
