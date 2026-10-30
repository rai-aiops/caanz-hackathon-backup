# CAANZ Hackathon TODO

Build one specialist, connect it to the Manager and test it before moving on.
Then add guardrails, test the full workflow and evaluate it through the dashboard.
Check each item only after verifying it.

Start with [setup](README.md#quick-start) and the
[CAANZ PRD](docs/reference/Agentic%20Prototype%20PRD%20-%20CAANZ.docx).
Use the [agent guide](docs/agents.md), [tool guide](docs/tools.md) and
[scenario catalog](docs/scenarios.md) for detailed requirements and PRD clarifications.
Keep the supplied runner, API, dashboard, fixtures and tool bodies in place.

Run one workflow at a time. Scenarios reset shared runtime data, and model-backed
runs incur usage. Humans retain remediation, closure and knowledge publication.
Leave guardrail imports and attachments until Steps 7–9.

## 1. Build the Applications Assignment Specialist

Files: [applications_assignment.py](custom_agents/applications_assignment.py),
[freshservice.py](tools/freshservice.py), [confluence.py](tools/confluence.py).

- [ ] Write `APPLICATIONS_ASSIGNMENT_PROMPT` using the PRD and agent guide.
- [ ] Implement the fields described in `ApplicationsAssignmentOutput`.
- [ ] Import/register its tools from the agent guide and implement their function-tool decorators.

The specialist classifies tickets using keywords, history and support articles.
It can route directly when historical evidence supports platform ownership;
otherwise it returns classification or manual review with drafted findings.
Classification/platform writes require `agent_confidence`, even before guardrails are attached.

```bash
uv run python -m py_compile custom_agents/applications_assignment.py tools/freshservice.py tools/confluence.py
```

## 2. Attach Assignment to the Manager and Test It

Files: [manager.py](custom_agents/manager.py), [freshservice.py](tools/freshservice.py).

- [ ] Implement `ManagerOutput` and replace the temporary prompt with the input contract and assignment route.
- [ ] Import/create Assignment, write its tool description and attach it with `as_tool`.
- [ ] Import/register the Manager's direct tools and implement their decorators.
- [ ] Pass the full current ticket and trigger to Assignment, save its findings and return persisted state.

Use `freshservice_applications_assignment_agent` as the specialist tool name.
Forward `hooks`, use `MAX_TURNS_SPECIALIST` and propagate failures with
`failure_error_function=None`. Follow this pattern for the remaining specialists.

```bash
uv run python main.py --scenario classification_from_history
uv run python main.py --scenario infrastructure_ticket
uv run python main.py --scenario education_ticket
uv run python main.py --scenario ambiguous_classification
```

- [ ] Verify direct Salesforce routing from history, human routing for Infrastructure/Education,
  and unchanged classification/platform/group for ambiguity. Inspect saved notes and traces.

These single-payload cases do not require Detection. Complete output fields before
running; an empty class can compile but cannot satisfy the runner.

## 3. Build the Platform Detection Specialist

Files: [platform_detection.py](custom_agents/platform_detection.py),
[confluence.py](tools/confluence.py), [boomi.py](tools/boomi.py),
[freshservice.py](tools/freshservice.py).

- [ ] Write `PLATFORM_DETECTION_PROMPT`.
- [ ] Implement `RequesterReplyDraft` and `PlatformDetectionOutput`.
- [ ] Import/register its tools and implement any remaining function-tool decorators.

Request missing incident facts, or use architecture/process documentation and
Boomi logs to identify the supported platform. Correlate time and affected-member
identity; distinguish other customers and recovered errors. Return grounded
findings with referenced log excerpts, or manual review when evidence is inconclusive.
The Manager saves comments and sends reply drafts.

```bash
uv run python -m py_compile custom_agents/platform_detection.py tools/boomi.py tools/confluence.py
```

## 4. Attach Detection to the Manager and Test It

File: [manager.py](custom_agents/manager.py).

- [ ] Create Detection, write its description and expose it as `applications_platform_detection_agent`.
- [ ] Continue new-ticket processing to Detection only when Assignment has not finished routing or requested manual review.
- [ ] Handle `requester_update`: save the additional facts once, then resume Detection.
- [ ] Save findings/log excerpts, send missing-information drafts and refresh ticket state before returning.

```bash
uv run python main.py --scenario no_errors_found
uv run python main.py --scenario conflicting_errors
uv run python main.py --scenario missing_timestamp_then_reply
```

- [ ] Verify manual review without platform assignment for absent/conflicting errors.
- [ ] Verify waiting, a saved reply and resumed investigation after the supplied timestamp.

Also inspect `alternate_email_identifier`, `multiple_timestamps`, `multiple_customers`
and `irrelevant_errors` for correlation edge cases. Scenarios with later confirmation
payloads need Knowledge Update; until Step 6, assess only their triage checkpoints.

## 5. Build the Knowledge Update Specialist

Files: [knowledge_update.py](custom_agents/knowledge_update.py),
[freshservice.py](tools/freshservice.py), [confluence.py](tools/confluence.py).

- [ ] Write `KNOWLEDGE_UPDATE_PROMPT` and implement `KnowledgeUpdateOutput`.
- [ ] Import/register its tools and implement any remaining function-tool decorators.
- [ ] Implement `review` and `finalize_tags` behavior from the agent guide.

Use the persisted human resolution/timeout outcome to assess support articles and
mappings. Return Freshservice recommendations for the Manager to save, create
justified Confluence review drafts and apply outcome/recommendation tags only
after the required records are saved. Preserve existing tags and avoid duplicate drafts.

```bash
uv run python -m py_compile custom_agents/knowledge_update.py tools/freshservice.py tools/confluence.py
```

## 6. Attach Knowledge and Test the Complete Manager

File: [manager.py](custom_agents/manager.py).

- [ ] Create Knowledge, write its description and expose it as `freshservice_confluence_knowledge_update_agent`.
- [ ] Route `resolution_confirmed` and `confirmation_timeout` to Knowledge review.
- [ ] Save any pending recommendation note, refresh the ticket and call `finalize_tags` with the previous result.
- [ ] Confirm all four trigger routes, three specialist connections and 17 platform-tool decorators are complete.

```bash
uv run python main.py --scenario happy_path
uv run python main.py --scenario missing_timestamp_then_reply
uv run python main.py --scenario missing_dependency_mapping
uv run python main.py --scenario outdated_dependency_mapping
```

- [ ] Verify initial routing, state continuity, saved recommendations/drafts and correct tags.
- [ ] Confirm mapping corrections are scoped and published knowledge remains unchanged.

`confirmation_timeout` has no saved scenario yet. Guardrail protection is tested next.

## 7. Implement Agent Guardrails

File: [agent_guardrails.py](guardrails/agent_guardrails.py).

- [ ] Implement the guardrail decorators and placeholder trip conditions.
- [ ] Block injection attempts and outputs below the 0.90 confidence threshold.
- [ ] Check confidence 0.89, 0.90 and 1.0, plus malicious and legitimate inputs.

Preserve supplied classifier prompts, usage tracking and telemetry. Use the
[guardrail guide](docs/guardrails.md) for expected behavior; attach guards in Step 9.

## 8. Implement Tool Guardrails

File: [tool_guardrails.py](guardrails/tool_guardrails.py).

- [ ] Implement the guardrail decorators and placeholder decisions.
- [ ] Allow valid confidence at or above 0.90; block missing, invalid or lower values.
- [ ] Block injection in retrieved content while allowing ordinary support evidence.
- [ ] Verify confidence boundaries and injection decisions, preserving logging and return behavior.

The confidence TODO comment currently reverses the intended rule. Follow the
[guardrail contract](docs/guardrails.md): allow at or above 0.90, block below it.

## 9. Attach Guardrails and Test Protected Paths

Files: [custom_agents/](custom_agents/), [tools/](tools/).

- [ ] Complete guardrail imports and attachments using the [attachment matrix](docs/guardrails.md#active-attachment-matrix).
- [ ] Resolve specialist input TODOs against that matrix; the core assignment leaves those input lists empty.
- [ ] Keep specialist failures propagating to the Manager.

```bash
uv run python main.py --scenario prompt_injection_attempt
uv run python main.py --scenario happy_path
uv run python main.py --scenario ambiguous_classification
```

- [ ] Verify injection stops ticket processing before delegation/writes, while ordinary workflows pass.
- [ ] Check Manager-input injection separately and verify low-confidence writes are blocked before mutation.

The saved injection case tests retrieved ticket content. Its expected tripwire
raises an exception, so a nonzero exit can be the correct result.

## 10. Run All Scenarios and Fix Broken Paths

Files: [scenarios.json](data/scenarios.json), [scenario catalog](docs/scenarios.md),
runtime records in `data/runtime/` and traces in `traces_logs/`.

```bash
uv run python main.py --scenario all
```

- [ ] Assess all 15 scenarios against their payload/final expectations, including shared defaults.
- [ ] Inspect routing, evidence, replies, tags, drafts and duplicate writes; keep expectations hidden from agents.
- [ ] Record failed scenario/payload IDs and trace evidence, fix issues and rerun affected cases before the full suite.

The CLI executes scenarios but does not score assertions. Check first-payload
routing before later human updates can supply platform values. Save evidence
before another run resets runtime; an expected injection block makes the batch exit nonzero.

## 11. Run the API and Test Payloads

Files: [api.py](api.py), [main.py](main.py), [scenarios.json](data/scenarios.json).

```bash
uv run python api.py
```

Open [Swagger](http://localhost:8000/docs) and use **Try it out**.

- [ ] Run `happy_path` through `/scenarios/run` and compare CLI/API outcomes.
- [ ] Check structured output, persisted ticket/conversation and trace/session IDs.
- [ ] Test ordered events through `/agents/run`, resetting once before a fresh sequence.
- [ ] Check invalid requests, unknown scenarios, overlapping runs and streaming errors.

Scenario routes reset automatically; individual triggers preserve runtime.
Inspect workflow results and stream error events as well as HTTP status.

## 12. Run the Dashboard and Evaluate Scenarios

Files: [dashboard/](dashboard/), [dashboard guide](docs/dashboard.md),
[judge-prompt.md](dashboard/prompts/judge-prompt.md).

With FastAPI running in another terminal:

```bash
cd dashboard
npm install
npm run dev
```

Open [the dashboard](http://localhost:3100).

- [ ] Run scenarios in Runs and compare Traces with saved records in Runs/Data.
- [ ] Select successful, manual-review and blocked traces in Evals.
- [ ] Add `data/scenarios.json` and relevant criteria as judge context; expectations are not loaded automatically.
- [ ] Review scores/reasoning and prompt recommendations, apply selected changes manually and rerun affected cases.
- [ ] Export the evaluation report and record remaining limitations.

Keep the scenario stream tab open while running. Separate judge/API errors from
scored failures; generic judge scores do not establish every scenario assertion or PRD KPI.

## Stretch Goals

### 1. Extend Scenario and Regression Coverage

Files: [scenarios.json](data/scenarios.json), [scenario catalog](docs/scenarios.md).

- [ ] Add timeout, missing-identifier, unavailable-log and write-failure scenarios.
- [ ] Automate selected state assertions and guardrail boundary checks without exposing expectations to agents.

### 2. Add PII Guardrails

Files: [guardrails/](guardrails/), [custom_agents/](custom_agents/), [tools/](tools/).

- [ ] Distinguish necessary incident identifiers from excessive disclosure in replies, notes, logs and drafts.
- [ ] Add privacy checks and synthetic scenarios covering allowed and blocked cases.

### 3. Optimize Cost and Latency

Files: [custom_agents/](custom_agents/), [utils.py](utils.py).

- [ ] Measure calls, tokens, cost and latency over the same scenario set.
- [ ] Reduce repeated reads or try model/settings changes while preserving evidence and passing regression checks.
