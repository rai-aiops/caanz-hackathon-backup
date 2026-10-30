# CAANZ agents

The Manager coordinates Applications Assignment, Platform Detection and Knowledge
Update through `agent.as_tool(...)`. It owns ticket retrieval, private notes,
requester replies and final synthesis. Humans retain root-cause analysis,
remediation, ticket closure and publication of knowledge recommendations.

See the [project README](../README.md) for setup, execution, models and limits,
[tool contracts](tools.md) for inputs and persistence behavior, and
[guardrail contracts](guardrails.md) for checks and stopping behavior.

## Agents and tools

| Module / factory | Connected tools |
| --- | --- |
| [manager.py](../custom_agents/manager.py) / `make_manager_agent(hooks=None)` | Lookup Ticket Data, Add Private Note, Send Reply and all three specialists |
| [applications_assignment.py](../custom_agents/applications_assignment.py) / `make_applications_assignment_agent()` | Lookup Dependency Map, Lookup Applications Support Keywords, Lookup Freshservice KB, Lookup Freshservice Historical Tickets, Update Ticket Classification, Update Ticket Platform, Get Acknowledgement Template, Lookup Freshservice Categories |
| [platform_detection.py](../custom_agents/platform_detection.py) / `make_platform_detection_agent()` | Lookup Dependency Map, Lookup Access Layer, Lookup Confluence KB, Inspect Boomi Log, Update Ticket Platform |
| [knowledge_update.py](../custom_agents/knowledge_update.py) / `make_knowledge_update_agent()` | Lookup Dependency Map, Lookup Freshservice KB, Create Confluence Draft, Lookup Freshservice Tags, Update Freshservice Ticket Tags |

Factories return fresh agents. Shared instances, factories and output models are
exported from [__init__.py](../custom_agents/__init__.py). The Manager passes its hooks into
specialist calls; the runner manages the outer run, session and trace.

The Manager receives JSON containing `trigger_type`, `ticket_id` and, for
`requester_update`, `email_content`. The application applies trusted ticket and
email updates before dispatch; see [event contracts](data.md#scenario-events-and-updates).

Specialists accept the SDK's `input` string containing JSON with `trigger_type`
and the full current `ticket`, including incident context, conversation, private
notes and resolution. Their tool names are:

- `freshservice_applications_assignment_agent`
- `applications_platform_detection_agent`
- `freshservice_confluence_knowledge_update_agent`

The Manager explicitly supplies this context. It refreshes the ticket after
specialist writes, before subsequent delegation and after the final write before
returning. Final classification, platform and `ticket_status` come from that read.

## Trigger procedures

| Trigger | Manager procedure |
| --- | --- |
| `new_ticket` | Read ticket → Assignment → save drafted comment → finish if routed or requiring manual review; otherwise refresh → Detection → save findings and send any missing-information reply |
| `requester_update` | Read updated ticket → save additional facts as a private note once → Detection → save findings and send any further question |
| `resolution_confirmed` | Read ticket with persisted human outcome → Knowledge review → save any Freshservice recommendation → finalize tags if needed |
| `confirmation_timeout` | Follow the knowledge procedure using the persisted timeout outcome |

The Manager reports saved actions only after successful tool results and returns
`waiting_for_information` after the missing-information reply is saved. It
preserves specialist evidence references in private notes and reports verified
failures as `failed`. End-of-trigger outcomes allow later events for the same
ticket; see [run lifecycle](data.md#validation-and-resets).

### Assignment and platform investigation

Assignment retrieves catalog options, dependency mappings and contextual support
keywords. When keywords are insufficient, it searches historical tickets and
support articles. Relevant historical resolution evidence can support direct
platform routing. Category and subcategory recommendations go in the drafted
comment. Infrastructure and Education classifications lead to manual review with
a human routing recommendation.

Detection requires an incident time and at least one affected-person identifier.
Missing facts produce a reply draft for the Manager. It reads the dependency map
and Access Layer separately, searches process documentation and correlates Boomi
logs using document IDs, event times and error/recovery context. It investigates
documented alternatives when mappings conflict with incident evidence and returns
manual review when evidence is absent or conflicting.

Detection reports all retrieved execution IDs. Its `drafted_comment` includes
verbatim log excerpts in fenced Markdown `text` blocks, each preceded by process
ID, execution ID, log path and one-based line range. Interpretation stays outside
the blocks. The Manager preserves this draft when saving the private note and
appends extra references outside the blocks. A platform boundary error supports
investigation and routing; root-cause conclusions remain with humans.

## Structured outputs

| Model | Status values | Reported information |
| --- | --- | --- |
| `ManagerOutput` | `platform_assigned`, `waiting_for_information`, `manual_review`, `knowledge_updated`, `failed` | Trigger, ticket ID, persisted classification/platform/status, saved notes/reply, draft IDs, summary, next action and errors |
| `ApplicationsAssignmentOutput` | `application_support_assigned`, `platform_assigned`, `manual_review`, `failed` | Saved classification/platform, category/subcategory recommendations, drafted comment, historical ticket IDs, evidence references and errors |
| `PlatformDetectionOutput` | `platform_assigned`, `waiting_for_information`, `manual_review`, `failed` | Assigned platform, missing facts, optional `RequesterReplyDraft`, drafted findings, process/execution IDs, evidence references and errors |
| `KnowledgeUpdateOutput` | `recommendation_pending`, `knowledge_updated`, `failed` | Outcome trigger, article ID/recommendation body, review comment, saved draft IDs, proposed/applied tags, evidence references and errors |

Every output also includes `confidence`, `confidence_reason` and `sources_used`.
Complete field definitions are in the agent modules above.

Workflow outcomes are separate from persisted Freshservice status.
`application_support_assigned` confirms classification; `platform_assigned`
confirms platform-team routing. Waiting and manual-review outputs report the
actual `ticket_status` and required requester, human or application `next_action`.

### Source reporting

`sources_used` lists knowledge resources that meaningfully contributed to the
current decision:

| Literal | Resource |
| --- | --- |
| `freshservice_knowledge_base` | Retrieved Freshservice support articles |
| `confluence` | Dependency map, Access Layer or process pages |
| `ticket_history` | Retrieved historical Freshservice tickets |
| `applications_support_keywords` | Retrieved support keywords used in classification |

Retrieval alone, irrelevant/empty results and tool failures do not count. Evidence
that rules out a candidate or supports manual review or no documentation change
can count. Current ticket facts, Boomi logs, catalogs, templates and draft creation
are outside these four resources. An empty list means none contributed.

Specialists report their contributions. The Manager combines reports used during
the current trigger without duplicates, including both Knowledge phases. See
[dashboard KPI definitions](dashboard.md#kpis-view) for run-level counting.

## Knowledge recommendation sequencing

Knowledge reviews published support articles and dependency mappings against an
explicit persisted resolution or timeout. Changes require an evidence-backed
error or material omission affecting future support. Recommendations identify
existing guidance, the proposed change and its practical benefit. Incident
routing alone does not establish integration ownership.

Freshservice recommendations include the article ID, evidence references and the
platform administrator mention defined in [knowledge_update.py](../custom_agents/knowledge_update.py).
Confluence recommendations are saved as review drafts targeting the retrieved
page ID and relevant section.

1. The Manager calls Knowledge with `phase: review`, the outcome trigger and the
   full ticket. Knowledge saves any required Confluence draft. If no Freshservice
   recommendation is pending, it applies tags and returns `knowledge_updated`.
2. On `recommendation_pending`, the Manager saves `recommendation_body` unchanged
   as a private note, then refreshes the ticket.
3. The Manager calls Knowledge with `phase: finalize_tags`, the refreshed ticket
   and `previous_knowledge_result`. Knowledge verifies the saved recommendation
   and required drafts, then applies tags without repeating review or drafts.

Knowledge follows the catalog's `tagging_guidelines`: add `AI` during outcome
review, choose `resolved` or `timeout` to match the outcome, preserve existing
tags and add recommendation tags only after their artifacts are saved.
`knowledge_updated` confirms completed review and saved recommendations/tags.
Published knowledge remains subject to human review.

## PRD wording and corrections

Prompts retain PRD personas and procedures with spelling/grammar corrections and
these operational clarifications:

- Requester updates resume Detection and save additional facts once; Knowledge
  follows explicit resolution or timeout.
- Detection identifies the platform for investigation, with root-cause analysis
  reserved for humans. Missing facts produce a waiting outcome; absent/conflicting
  evidence and Infrastructure/Education routing require manual review.
- Classification options come from the catalog. Dedicated historical-ticket
  search supplements keywords and support articles, as recorded in the reference PRD.
- Prompt tool references use current page bodies, execution logs and message
  models, with the full ticket supplied explicitly to specialists.
- Knowledge uses review/finalize phases to save recommendations before tagging.
  Outputs distinguish workflow outcomes from verified persisted actions.

The source PRD is listed in [data provenance](data.md#sources-and-synthetic-content).
For recorded model-run results, see
[scenario verification history](scenarios.md#recorded-verification-history).
