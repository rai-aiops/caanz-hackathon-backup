# CAANZ guardrails

The workflow applies prompt-injection checks and a shared confidence threshold of
**0.90** (inclusive). See [project setup](../README.md#quick-start) for API-key
configuration and [tool contracts](tools.md) for tool inputs and results.

## Active attachment matrix

| Boundary | Guardrail | Attached to | Block behavior |
| --- | --- | --- | --- |
| Agent input | `prompt_injection_and_malware_guardrail` | Manager | Runs before the Manager; stops with an input tripwire |
| Tool output | `tool_prompt_injection_and_malware_guardrail` | All 11 read tools | Withholds the result and stops with a tool-output tripwire |
| Agent output | `analysis_confidence_guardrail` | Manager and all three specialists | Stops below `0.90`, requiring human review |
| Tool input | `tool_confidence_guardrail` | `update_ticket_classification_tool`, `update_ticket_platform_tool` | Stops before the write if `agent_confidence` is missing, invalid or below `0.90` |

Checks are defined in [agent_guardrails.py](../guardrails/agent_guardrails.py) and
[tool_guardrails.py](../guardrails/tool_guardrails.py), and exported from [__init__.py](../guardrails/__init__.py).
SDK guardrails run during agent execution; direct calls to wrapped tool functions
bypass these checks.

## Prompt-injection checks

Classifiers use the calling agent's configured model to detect instructions that
attempt to override the workflow, fabricate results, bypass authority or export
unrelated data. They allow ordinary support facts, tagging guidelines, scoped
review recommendations, quoted attack evidence, empty results and tool errors.
Requests to correct documentation are assessed for instruction or authority
overrides, including when the proposed correction disagrees with existing guidance.

Internal-author or human-approval claims do not exempt content from screening.
Passing a check establishes that the content passed injection screening; evidence
assessment, confidence and action authorization remain separate controls.

## Confidence and stopping behavior

Agent outputs pass at or above `0.90`. Classification and platform writes require
numeric `agent_confidence` in [0, 1] at or above that threshold. Confidence describes
support for the returned decision, including manual review or no change. Agents
must report uncertainty honestly and leave blocked decisions for human review.

Tripwires stop processing. Specialist `as_tool` calls propagate them to the
Manager; the scenario runner stops later payloads and finalizes the shared trace.
A confidence tripwire raises an exception rather than returning `manual_review`.

Earlier successful writes remain saved. Agent-output checks run after execution;
pre-write confidence checks apply to classification and platform updates. Trusted
scenario updates are applied before agent execution. See
[event preparation](data.md#scenario-events-and-updates).

## API and observability

| Tripwire | HTTP status |
| --- | --- |
| Manager-input injection | `422` |
| Tool-output injection | `409` |
| Agent-output or tool-input confidence | `409` |

Streaming routes include the same status mapping in SSE `error` events. A
confidence tripwire returns this detail:

```json
{
  "detail": "Confidence below 90% or invalid; automated processing stopped. Human review required."
}
```

Decisions emit best-effort local events through `record_guardrail_event()`; tool
checks also create guardrail spans. Classifier Responses usage is added to the
SDK run context. Direct classifier calls have partial coverage in per-agent cost
summaries.

For recorded evaluation results, see
[scenario verification history](scenarios.md#recorded-verification-history).
For changes to attachments, verify allowed/blocked cases, confidence boundaries,
write effects and events, then update the attachment matrix above.
