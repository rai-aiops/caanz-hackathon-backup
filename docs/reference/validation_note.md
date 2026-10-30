# Synthetic Data Validation Note
**Files covered:** `dependency_map_synthetic.json`, `access_layer_synthetic.json`
**Prepared by:** Integration Team
**Date:** 2024-09-10
**Purpose:** Handover note for prototype use. Lists structural decisions, gaps, and items needing human review before any production use.

---

## 1. Structural Changes (vs. real Confluence JSON export)

- **Schema is invented.** Neither file is a real Confluence REST API export. The structure (`page`, `dependencyMap`, `accessLayer`, `entries`) was designed to be readable by an LLM agent and is not compatible with the Confluence Cloud export format out of the box.
- **`mockBoomiResponse` blocks added** to `dependency_map_synthetic.json`. These are not part of any Confluence schema — they are prototype-only fields. The agent reads them when `PROTOTYPE_MODE=true` instead of calling the live Boomi Platform API. Remove or ignore these fields in production.
- **`actualProcessName` field** is a placeholder (`REPLACE_WITH_REAL_BOOMI_PROCESS_NAME`) on every entry. This must be populated with the real Boomi process name before live API calls can be made.
- **`schemaVersion`** is synthetic versioning only — not tied to any real document versioning system.

---

## 2. Unresolved References

- **`PaymentGateway`** appears as a system in `dm-002` (dependency map) and in the access layer (`layer-004`), but has no owning internal team — vendor-managed. Any ticket involving PaymentGateway errors requires a manual check of the vendor status page before escalation.
- **`NotificationService`** similarly has no internal owner. Failures here are non-blocking by design (logged as warnings only).
- **`EventManagementSystem`** ownership is assigned to `IntegrationTeam` as a placeholder — this has not been confirmed with the business. The ID-mapping gap noted in `dm-003` is a known unresolved dependency.
- **`MemberFeedbackRouter`** (`dm-007`) — process existence in Boomi is unconfirmed. Mapping was assumed from architecture review only.
- **`IdentityProvider`** — referenced in both files but has no integration process. Any ticket matching `dm-006` keywords should be routed to `InfrastructureTeam` without calling `boomi_scan.py`.

---

## 3. Limitations

- **Trigger keywords are not exhaustive.** The `triggerKeywords` arrays cover common phrasings but will miss variations. A real implementation would use semantic similarity, not keyword matching.
- **`commonErrors` lists are illustrative.** They cover known patterns from design-time assumptions — not from actual production log analysis.
- **No real member IDs, execution IDs, or credentials** appear anywhere in these files. All IDs (e.g. `exec-mock-dm001-001`, `proc-e1a2b3c4`) are fictional.
- **Mock responses cover one scenario per entry** (with an alt scenario for `dm-001` only). Real Boomi logs will return varied structures — the agent's parsing logic will need to handle a wider range of error shapes.
- **Access layer SLA figures** are illustrative placeholders — not sourced from real vendor agreements or internal SLA documentation.
- **`integrationTopology.flows`** in the access layer describes left-to-right data flow only — it does not represent error propagation, retry behaviour, or partial-success scenarios.

---

## 4. Items Requiring Human Review Before Production Use

| Item | File | Action Required |
|---|---|---|
| `actualProcessName` on all entries | `dependency_map_synthetic.json` | Replace with real Boomi process names — confirm with IntegrationTeam |
| `dm-007` MemberFeedbackRouter mapping | `dependency_map_synthetic.json` | Confirm process exists in Boomi and validate mapping with CRMTeam |
| `dm-003` EventManagementSystem ownership | `dependency_map_synthetic.json` | Confirm owning team with business stakeholders |
| `dm-005` CPD activity type code mapping | `dependency_map_synthetic.json` | Full list of CRM activity type codes needed from CRMTeam |
| All `confidence=medium` and `confidence=low` entries | `dependency_map_synthetic.json` | Validate against production Boomi logs before agent goes live |
| SLA figures for all systems | `access_layer_synthetic.json` | Replace with figures from actual SLA documentation |
| PaymentGateway and NotificationService vendor status URLs | `access_layer_synthetic.json` | Replace fictionalised URLs with real vendor status pages |
| `PROTOTYPE_MODE` flag | `boomi_scan.py` | Must be set to `false` and real credentials configured before any production run |

---

*No production data, member records, credentials, or real system values appear in the attached files. All identifiers are synthetic.*
