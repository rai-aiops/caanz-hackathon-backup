# Local tools

The CAANZ agents use 17 tools backed by local Freshservice, Confluence and Boomi
fixtures in `data/runtime/`. Requester replies are saved in ticket conversations
as simulated outbound messages.

See the [project README](../README.md) for setup and execution,
[data guide](data.md) for fixtures and resets,
[agent contracts](agents.md) for workflow responsibilities, and
[guardrail contracts](guardrails.md) for attached checks and thresholds.

## Modules

| Module | Responsibility |
| --- | --- |
| [freshservice.py](../tools/freshservice.py) | Ticket and catalog models, reads, searches, classification, platform routing, notes, replies and tags |
| [confluence.py](../tools/confluence.py) | Page models, architecture reads, process-page search and review drafts |
| [boomi.py](../tools/boomi.py) | Incident-correlated execution records and complete logs |
| [helpers.py](../tools/helpers.py) | JSON reads, atomic writes, write locking and search ranking |

Tools, models and helpers are exported explicitly from [__init__.py](../tools/__init__.py).
The `*_tool` exports are Agents SDK `FunctionTool` objects for an agent's tools
list. For focused local verification, invoke their
`on_invoke_tool(ToolContext(...), json_arguments)` interface.

## Read tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `lookup_ticket_data_tool` | `ticket_id` | `FreshserviceTicket`: current ticket, incident, conversation, private notes and resolution |
| `lookup_freshservice_categories_tool` | None | `FreshserviceCategoriesResult`: `classifications` and `categories` with subcategories |
| `lookup_applications_support_keywords_tool` | `query=""`, `limit=10` | `FreshserviceSearchResult`: ranked keyword records with contextual classification hints |
| `lookup_freshservice_historical_tickets_tool` | `query`, `current_ticket_id`, `limit=10` | `FreshserviceSearchResult`: ranked closed-ticket records with classification, category, platform, group, notes and resolution |
| `lookup_freshservice_knowledge_base_tool` | `query`, `limit=10` | `FreshserviceSearchResult`: ranked published support articles |
| `get_acknowledgement_template_tool` | None | `FreshserviceTemplateResult`: `subject`, `body` and `placeholders` |
| `lookup_freshservice_tags_tool` | None | `FreshserviceTagsResult`: `tags` and natural-language `tagging_guidelines` |
| `lookup_dependency_map_tool` | None | `ConfluencePage`: dependency-map metadata and body |
| `lookup_access_layer_tool` | None | `ConfluencePage`: Access Layer metadata and body |
| `lookup_confluence_knowledge_base_tool` | `query`, `limit=10` | `ConfluenceSearchResult`: ranked published process pages |
| `inspect_boomi_log_tool` | `process_id`, timezone-aware `incident_timestamp`, at least one of `customer_id`, `member_id`, `customer_email`, `customer_name` | `BoomiInspectionResult`: query, matching execution records, document matches and complete logs |

### Search behavior

Freshservice and Confluence searches return `matches`, each containing `record`,
`matched_terms`, `matched_fields` and an integer `score`. Ranking counts distinct,
case-insensitive Unicode word matches. Ties sort by record ID, then source order.
Scores measure retrieval relevance. Limits are 1–50, defaulting to 10; empty
results return `matches: []`.

| Search | Matched fields |
| --- | --- |
| Support keywords | Term, expansion, aliases and context |
| Historical tickets | Subject, description, private notes and resolution |
| Freshservice articles | ID, title, body, tags, platforms and process IDs |
| Confluence pages | ID, title and body |

Empty queries list eligible records in ID order. Historical-ticket search
requires a nonempty query, excludes `current_ticket_id` and uses catalog status
states to select closed tickets. An exact recognized process ID or name in a
Confluence query restricts results to pages with the corresponding `Process ID:`
line in their body.

### Boomi log inspection

Supported process IDs and names are defined in `BOOMI_PROCESSES` in
[boomi.py](../tools/boomi.py). Inspection reads `boomi_logs/execution_records.json` and
selects execution intervals overlapping the inclusive five minutes before and
after the incident. Log paths must resolve under runtime `boomi_logs/`.

The fixtures use a custom `Document context` Notify message containing
`documentId`, `customerId`, `memberId`, `email` and `customerName`. All supplied
nonblank identifiers must match one document context after case and whitespace
normalization.

`BoomiInspectionResult` contains:

- `query`: process, incident time, window bounds and supplied identity fields.
- `executions`: matches sorted by execution time, then ID. Each contains a typed
  `record` with execution/process IDs, start time, duration, status and Atom details;
  `matched_documents` with document IDs and one-based identity-line references;
  and `log` with its path, complete raw `lines`, `start_line: 1` and `end_line`.

Logs use five tab-separated columns: timestamp, level, shape, detail and message.
Results retain all matching executions and their complete logs, including other
batch customers, recovered errors and lines outside the selection window.
Callers correlate document IDs, event times and failure/recovery context.
No match returns `executions: []`.

## Write tools

| Tool | Inputs | Saved result |
| --- | --- | --- |
| `update_ticket_classification_tool` | `ticket_id`, `classification`, `agent_confidence` | `FreshserviceTicket` with only classification updated to a catalog value |
| `update_ticket_platform_tool` | `ticket_id`, `platform`, `agent_confidence` | `FreshserviceTicket` with catalog platform, mapped group and `Assigned` status |
| `add_private_note_tool` | `ticket_id`, `body` | `FreshserviceNote` appended to the ticket, with timestamp, automated CAANZ author and body |
| `send_reply_tool` | `ticket_id`, `subject`, `body` | `FreshserviceMessage` appended to the ticket conversation, addressed to the requester from `servicedesk@example.com` with empty CC |
| `create_confluence_draft_tool` | `source_ticket_id`, `target_record_id`, `title`, `body` | `ConfluencePage` appended to the knowledge store with generated ID, `draft` status, author `CAANZ workflow` and source/target references in its body |
| `update_freshservice_ticket_tags_tool` | `ticket_id`, `tags` | `FreshserviceTicket` with supplied and existing tags merged and exact duplicates removed |

Classification and platform writes reject resolved/closed tickets. Both accept
`agent_confidence` in [0, 1], subject to the attached
[confidence guardrail](guardrails.md#active-attachment-matrix).

Notes, replies and drafts trim their text and reject blank bodies; replies and
drafts also require nonblank subjects/titles. Each successful call appends a new
record, so repeating a confirmed successful call creates a duplicate. Draft
creation advances the store's draft counter and adds source/target references
as body text; callers supply valid references.

Tag strings are merged as supplied. Callers select tags, including `AI`, according
to the catalog's `tagging_guidelines`. See
[knowledge recommendation sequencing](agents.md#knowledge-recommendation-sequencing)
for outcome checks and saving recommendations before tagging.

## Results, errors and persistence

Tools return Pydantic models directly. Ticket `status` describes persisted ticket
state; Confluence `status` describes published or draft content. Confluence pages
share metadata fields (`id`, `title`, `status`, `version`, `created_at`,
`updated_at`, `author`) and a text `body`; unknown timestamps/authors are null.
See the domain modules for complete model definitions.

Missing records, invalid operations, validation failures and storage failures
raise exceptions. The normal SDK tool handler converts tool-body exceptions into
error feedback. SDK argument validation runs before the tool body; attached
guardrail tripwires stop processing as described in the
[guardrail contracts](guardrails.md#confidence-and-stopping-behavior).

Write tools preserve existing conversations and notes. Read tools access stores
directly; writes hold `fixture_lock()` around read-modify-write operations and
atomically replace JSON files. The lock combines thread and process locking on
macOS, Linux and Windows. Application code using `read_store()`/`write_store()`
for read-modify-write operations must also hold the lock. Run fixture resets
separately from tool operations; see [reset instructions](data.md#validation-and-resets).
