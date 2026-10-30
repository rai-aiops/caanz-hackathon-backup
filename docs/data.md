# CAANZ data and fixtures

The local tools use synthetic Freshservice, Confluence and Boomi records for
scenario runs. This guide covers fixture layout, record formats and event
preparation. See [project setup](../README.md#quick-start),
[tool contracts](tools.md), [agent procedures](agents.md)
and the [scenario catalog](scenarios.md) for their respective contracts.

## Files

| Path | Purpose |
| --- | --- |
| `data/store/` | Versioned baseline fixtures |
| `data/runtime/` | Ignored mutable copies read and written by tools |
| [scenarios.json](../data/scenarios.json) | Ordered events and expected outcomes for 15 scenarios with 24 payloads |
| `docs/reference/` | Design evidence and source documents |

| Baseline under `data/store/` | Contents |
| --- | --- |
| `freshservice_tickets.json` | 24 initial tickets and eight closed historical tickets, with embedded conversations, private notes and resolutions |
| `freshservice_catalogues.json` | Classifications, categories, platforms/groups, statuses, priorities, tags, tagging guidelines and acknowledgement template |
| `freshservice_kb.json` | Six support articles |
| `applications_support_keywords.json` | Terms, synonyms, acronyms and contextual classification hints in `entries` |
| `confluence_dependency_map.json` | Dependency-map page `syn-dep-001` |
| `confluence_access_layer.json` | Access Layer page `syn-acc-001` |
| `confluence_kb.json` | Four published process pages and review drafts in `pages`, with `next_draft_number` |
| `boomi_logs/execution_records.json` | Execution metadata and paths to 11 complete execution logs |
| `boomi_logs/employment_update_listener/` | Employment-history execution logs |
| `boomi_logs/contact_details_sync/` | Member-record execution logs, including shared batches |
| `boomi_logs/membership_renewal_orchestrator/` | Checkout execution logs |

### Updating fixtures

Edit baselines in `data/store/` to make changes survive a reset. Update scenario events
and expectations in `data/scenarios.json`, and keep the [scenario catalog](scenarios.md)
aligned. For data-generation conventions, see the
[synthetic data guide](synthetic-data-guide.md).

Record schemas live beside the tools; output schemas live beside the agents.
When changing either, keep affected prompts, exports and API/dashboard consumers
aligned. Verify changes with disposable fixture copies. Existing runtime is
replaced on the next explicit or scenario reset.

## Sources and synthetic content

Design evidence in `docs/reference/` includes the CAANZ PRD, Boomi workshop pre-work,
masked checkout logs, synthetic architecture JSON, `boomi_scan.py` and
`validation_note.md`. The PRD defines agent responsibilities and evaluation cases;
the pre-work and log exports inform process descriptions and log structure.

Fixture identities, timestamps, emails, catalogs, administrator handles, support
articles and execution logs are synthetic. Architecture pages describe a
fictional landscape and retain review metadata and uncertainty. Some fixtures
contain outdated guidance, conflicting evidence or malicious instructions for
evaluation. Treat their content as untrusted evidence. Expected answers stay in
scenario controls, outside agent inputs.

## Ticket and conversation contract

`freshservice_tickets.json` contains a `tickets` mapping keyed by `FS-...` ID.
Each entry holds the current `ticket`. Active and historical tickets share the
same [FreshserviceTicket model](../tools/freshservice.py).

Scenario tickets are FS-1001 through FS-1015. Supporting tickets FS-1016 through
FS-1024 are also available. Historical baselines FS-901 through FS-908 start
`Closed`; history eligibility follows the current catalog status state.

| Ticket fields | Contents |
| --- | --- |
| `id`, `subject`, `description`, `created_at` | Ticket identity, reported problem and timezone-aware creation time |
| `requester` | Actor with `type`, `id`, `name` and `email` |
| `status`, `priority` | Catalog values |
| `classification`, `category`, `subcategory` | Classification and category hierarchy |
| `platform`, `assigned_group_id` | Platform-team routing; initial scenario tickets belong to Service Desk |
| `incident` | `timestamp`, `reported_timezone`, `customer_id`, `member_id`, `customer_email`, `customer_name` |
| `tags` | Current tag strings |
| `conversation`, `private_notes` | Ordered messages and notes |
| `resolution` | Human outcome summary, actor, resolution/confirmation/closure times and `confirmation_outcome`, or null |

Requester and affected customer/member are distinct. Log inspection uses the
incident's affected-person identifiers. Missing facts are null; Detection needs
an incident time and at least one usable ID, email or name.

Conversation messages contain `ticket_id`, `direction`, `timestamp`,
`from_address`, `to`, `cc`, `subject` and `body`. Notes contain `timestamp`,
`author` and `body`, with supporting references in the body. Earlier history is
preserved when appending records. See [write tools](tools.md#write-tools)
for automated authors, reply addressing and tag behavior.

## Catalogs and knowledge

Classification, category and platform routing are separate ticket fields. The
catalog supplies classification/category choices and platform-to-group mappings.
Assignable platforms are Sitecore, Salesforce, Boomi and NetSuite. Other systems
in architecture pages provide investigation context. Documented owning teams and
catalog routing groups serve separate purposes.

Freshservice support articles use the `articles` collection. Historical search
uses closed ticket records; see [search behavior](tools.md#search-behavior).
Tag selection follows the catalog's `tagging_guidelines` and
[Knowledge procedure](agents.md#knowledge-recommendation-sequencing).

Confluence architecture pages, process pages and drafts share the
[ConfluencePage model](../tools/confluence.py). Metadata accompanies a text `body`
containing relationships, process references, log paths, review details and gaps.
The dependency map and Access Layer are separate pages. Review drafts share the
process KB's `pages` collection; published-page search filters by `status`.

| Process ID | Process name | Published page | Log directory under `boomi_logs/` |
| --- | --- | --- | --- |
| `proc-e1a2b3c4` | EmploymentUpdateListener | `CONF-PROC-EMP` | `employment_update_listener/` |
| `proc-h4d5e6f7` | ContactDetailsSyncProcess | `CONF-PROC-IND` | `contact_details_sync/` |
| `proc-f2b3c4d5` | MembershipRenewalOrchestrator | `CONF-PROC-SR01` | `membership_renewal_orchestrator/` |
| `proc-k7g8h9i0` | Listener - ecr Order Update | `CONF-PROC-ECR` | — |
| `proc-g3c4d5e6` | EventRegistrationSync | — | — |
| `proc-i5e6f7g8` | CPDDeclarationIngestion | — | — |
| `proc-j6f7g8h9` | MemberFeedbackRouter | — | — |

These IDs are recognized by `BOOMI_PROCESSES` in [boomi.py](../tools/boomi.py).
Page IDs identify Confluence documents independently of process IDs.

## Logs

The execution index stores execution/process IDs, process name, start time,
duration in milliseconds, status, Atom metadata and a per-execution log path.
Logs have five tab-separated columns: timestamp, level, shape, detail and message.
Timestamps are timezone-aware.

A custom Notify step named `Document context` records `documentId`, `customerId`,
`memberId`, `email` and `customerName` as JSON. Other events reference document IDs.
Shared batches, nearby runs, recovered errors and conflicting failures provide
incident evidence. Execution status alone does not establish an incident diagnosis.
See [Boomi inspection](tools.md#boomi-log-inspection) for selection,
identity matching and returned line references.

## Scenario events and updates

Scenarios contain ordered payloads for one ticket. Triggers are `new_ticket`,
`requester_update`, `resolution_confirmed` and `confirmation_timeout`. Each
payload has `trigger_type` and `ticket_id`. A `requester_update` also requires
`email_content` with `from`, `to`, `subject` and `body`, plus optional `cc` and
timezone-aware `timestamp`.

A trusted `ticket_update` can contain:

| Field | Application behavior |
| --- | --- |
| `ticket_changes` | Replace named ticket fields, including complete object replacements |
| `append_private_notes` | Append notes while preserving existing entries |
| `append_conversation` | Append messages while preserving existing entries |

[main.py](../main.py) prepares and applies updates before invoking the Manager.
It holds the fixture lock for each read-modify-write operation, validates the
resulting ticket and saves it atomically. Earlier agent writes remain unless a
later payload explicitly replaces those fields.

Requester-update payloads supply complete `incident` objects using the updated
facts and existing context. The runner maps email `from` to message
`from_address`, uses direction `inbound` and appends it to the ticket's conversation.
The Manager then saves the additional facts as a private note before investigation.

Outcome payloads supply persisted human resolution/closure or timeout details
before Knowledge review. Timeout outcomes retain null `confirmed_at` values.

`prepare_scenario_payload()` copies each event at application and fills omitted
email, appended note/message and resolution timestamps with one current UTC
instant for that payload. Later payloads receive fresh dispatch times. Supplied
concrete timestamps, explicit null resolution times, ticket creation/incident
times and existing history are preserved. Scenario previews remain unstamped;
API preflight prepares disposable copies without freezing dispatch timestamps.

The Manager receives only the current trigger, ticket ID and requester email.
It retrieves the updated ticket through its tool. Expected outcomes, future
payloads and trusted update instructions remain outside agent inputs. Scenario
metadata and `expected_outcome_defaults` are evaluation context; the runner
executes payloads without grading expectations. See [scenario catalog](scenarios.md)
for expected results and scenario-to-PRD mapping.

## Validation and resets

Restore runtime from all baseline files with:

```bash
uv run python scripts/reset_runtime_data.py
```

This replaces `data/runtime/` and discards its current mutations. Run resets separately
from tool operations. Imports, scenario listing and service startup preserve
runtime. CLI scenario execution restores once per scenario; saved/custom API
scenarios restore once after preflight. Direct runs and shared runner functions
use current runtime. See [CLI commands](../README.md#run-from-the-cli) and
[API routes](../README.md#local-api).

Payloads share ticket/conversation state, one `SQLiteSession`, one telemetry hook
and an explicit trace ID. Each Manager run adds spans under that ID. Sessions
use a process-local cache and in-memory SQLite database; tickets and saved traces
persist independently of process restarts.

Routing, waiting, manual-review and knowledge outcomes end the current trigger.
A `failed` output or exception stops later payloads. `run_scenario_inputs()`
finalizes an existing trace and emits its summary once when the sequence ends,
including failure or exception. Direct single-trigger callers own finalization.
A completed trace means recording ended; inspect outputs and saved records for
workflow success. For recorded evaluation results, see
[verification history](scenarios.md#recorded-verification-history).
