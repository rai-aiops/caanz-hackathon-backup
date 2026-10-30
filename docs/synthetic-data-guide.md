# Synthetic data for agentic prototypes

Useful fixtures preserve realistic relationships and require agents to interpret
evidence. This guide covers generation practices and how the CAANZ fixtures were
constructed from the supplied references. See the [data guide](data.md) for
schemas, identifiers and operating commands.

## Generation practices

1. **Design the evidence before writing records.** For each scenario, define the
   decision, required facts, available sources and uncertainty. Include successes,
   missing evidence, conflicting signals and human review. Generate only the scale
   needed to exercise those distinctions.

2. **Create a coherent fictional environment.** Preserve useful relationships,
   ownership roles, source-to-target direction and missing mappings. Replace
   identifying content across records, prose, payloads and links. Use reserved
   example domains and nonfunctional credentials. Check for sensitive remnants and
   distinctive combinations; renaming alone does not guarantee anonymity.

3. **Keep knowledge, observations and expected answers separate.** Architecture
   describes candidate relationships; logs record events; historical tickets
   record prior findings. Expected outcomes and future scenario events belong
   outside agent-visible records. Keep diagnostic labels and mock-response blocks
   that pre-answer investigations out of knowledge documents.

4. **Match the tool contract and preserve source meaning.** Keep stable IDs,
   timezone-aware timestamps, valid references and explicit null/empty values.
   Adapt source formats deliberately and record important differences. A plausible
   fixture must also be retrievable through the actual tool, including its time,
   identity and search rules.

5. **Put ambiguity where the agent can see it.** Keep other customers in shared
   logs, nearby executions and recovery messages when those distinguish correct
   reasoning from a shortcut. An unused file adds no coverage. Scope deliberate
   errors narrowly so they do not accidentally change unrelated scenarios.

6. **Preserve uncertainty and provenance.** Distinguish source observations,
   fictional adaptations and assumptions. Retain unconfirmed ownership and missing
   evidence rather than silently repairing them. Store human outcomes as external
   events; an agent must not manufacture confirmation, remediation or closure.

7. **Validate retrieval and reasoning separately.** Check record shapes,
   relationships and exact tool results before running models. Then inspect agent
   decisions, source use, persisted writes and guardrail behavior. A valid JSON
   file or successful mock run does not establish agent quality.

## Reference material and its contribution

The files in [reference/](reference/) are construction inputs, not runtime stores.

| Supplied material | Contribution to the prototype |
| --- | --- |
| [CAANZ PRD](<reference/Agentic Prototype PRD - CAANZ.docx>) | Agent responsibilities, triggers, routing behavior, knowledge review and 14 evaluation rows. |
| [Boomi pre-work](reference/AI_Ops_Workshop_PreWork_Boomi.docx) | Four process descriptions and NetSuite failure patterns, including an exception despite successful execution status. |
| [Synthetic dependency map](reference/dependency_map_synthetic.json) and [Access Layer](reference/access_layer_synthetic.json) | Fictional member actions, systems, layers, topology, process candidates, ownership and uncertainty. |
| [Masked checkout log](<reference/ProcessLog_SR-01 Proceed To Checkout_masked.log>) | Five-column event format and realistic connector/request/response context. This particular execution completes normally; the fixture failures were constructed separately. |
| [Scanner script](reference/boomi_scan.py) | Separation between execution-record discovery and log download; its mock mode loads responses from the supplied dependency map. |
| [Validation note](reference/validation_note.md) | Identifies the JSON schema as invented, with illustrative errors/SLAs and unresolved process and ownership references. |

The pre-work describes a narrower NetSuite investigation with human confirmation
before ticket actions. The prototype follows the PRD's broader classification and
routing workflow; Salesforce failures and other evaluation variants are synthetic
extensions, not additional production observations.

## How the current fixtures were constructed

### Architecture and process documentation

The supplied JSON pair was already synthetic. Its nested content was converted to
the local `ConfluencePage` envelope, with relationships and descriptive content
rendered as Markdown in `body`. Source review metadata was retained; source status
`current` became local status `published`. These pages simulate extracted
Confluence content, not a native Confluence REST export.

The dependency map's prototype-mode configuration, `mockBoomiResponse` and
alternative response blocks, and placeholder `actualProcessName` fields were
removed. Business actions, common error patterns, ownership and confidence notes
remain. The four generic platform names became Boomi, Salesforce, NetSuite and
Sitecore; supplied owning-team names were preserved. NotificationService was
assigned consistently to the External layer.

The pages retain IDs `syn-dep-001` and `syn-acc-001`. Employment, contact/profile
and renewal/checkout evidence was reconciled to the supplied process names and
IDs across articles, keywords, execution records and scenarios. ECR remains a
separate legacy process. Event registration, CPD ingestion and feedback routing
are recognized candidates without process articles or logs. Other systems remain
in the architecture but do not gain platform-assignment support. The
[current process table](data.md#catalogs-and-knowledge) and
[tool contracts](tools.md) describe the supported behavior.

### Execution records and raw logs

The baseline contains an execution index and 11 synthetic logs. Metadata such as
execution IDs, durations and Atom identifiers was constructed consistently with
the fictional events. Logs use five tab-separated columns: timestamp, level,
shape, detail and message. Error, success and recovery events were written to
expose the PRD's intended decisions rather than copied wholesale from the
successful masked log.

A custom Notify step named `Document context` carries document/customer/member
IDs, email and name as JSON. This is fixture instrumentation, not a native Boomi
identity column. Subsequent events reference document IDs so the agent can
separate customers inside a batch.

The local retrieval tool accepts process ID, incident time and affected-person
identifiers. It returns every execution overlapping the inclusive five minutes
before/after the incident when all supplied identities match one document context.
Complete logs retain other customers and recovery events. The supplied live
scanner instead queries by name, status, Atom and lookback, then selects its first
returned execution. The prototype does not invoke that script or use its printed
diagnosis as evidence. Eight unused executions were pruned; useful distractors
inside the retained logs remain.

### Tickets and scenario sequences

Fictional tickets, catalogs, support articles and keywords complete the local
Freshservice environment. The baseline has 24 initial tickets and eight closed
historical tickets. Requesters and affected members are distinct. Conversations,
private notes and resolutions remain embedded on tickets.

The 15 scenarios contain 24 ordered payloads covering the PRD's 14 rows. Trusted
requester updates and human outcomes are applied before dispatch; later facts and
expectations stay hidden from agents. Deliberate evidence includes:

- Nearby failures at different times, mixed-customer batches, recovered errors,
  successful runs and unresolved conflicting errors.
- A wrong mapping scoped to the Professional history legacy screen, contrasted
  with correct process documentation and incident evidence.
- An unmapped QPR capability, supporting a recommendation without inventing a
  process or owner.
- The undocumented Lumen/LMN-47 recurrence. Closed ticket FS-901 supplies the
  human diagnosis and Salesforce ownership needed for Assignment to route directly
  without Detection or log inspection.
- Malicious ticket instructions for injection checks and supporting privacy test
  content; these are untrusted evidence, not instructions for fixture authors.

## Extending and checking the fixtures

Edit [store/](../data/store/) and [scenarios.json](../data/scenarios.json), preserving the intended
relationships across tickets, articles, process IDs, execution paths and evidence
line references. Keep supplied references unchanged. Validate JSON/Pydantic
shapes, unique IDs, catalog values, timestamp order, log columns and cross-file
references. Exercise positive, empty and error paths against disposable copies,
and check the exact executions/documents returned for each ambiguity case.

For behavior changes, run the smallest relevant model-backed scenario and inspect
its actual tool calls and saved records against expectations. Keep verification
results separate from fixture claims; coverage is not proof that every case
passes. There is no maintained automatic fixture generator or standalone validator.

Tools operate on ignored `runtime/`, not reference inputs or baseline files.
Baseline changes take effect at the next scenario or explicit reset; never reset
between payloads of one scenario. Use the [reset instructions](data.md#validation-and-resets)
when ready to replace runtime, and keep credentials and generated state out of
commits.
