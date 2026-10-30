from datetime import UTC, datetime
from typing import Any, Literal

from agents import get_current_trace

from utils import emit_local_observability_event


def record_guardrail_event(
    *,
    scope: Literal["agent", "tool"],
    stage: Literal["input", "output"],
    name: str,
    passed: bool,
    agent_name: str,
    output_info: dict[str, Any],
    tool_name: str | None = None,
) -> None:
    """Emit a compact guardrail decision to local observability."""
    event = {
        "type": f"{scope}_{stage}_guardrail",
        "timestamp": datetime.now(UTC).isoformat(),
        "source": "guardrails",
        "guardrail_name": name,
        "guardrail_scope": scope,
        "guardrail_stage": stage,
        "passed": passed,
        "triggered": not passed,
        "agent_name": agent_name,
        "output_info": output_info,
    }
    if tool_name:
        event["tool_name"] = tool_name

    current_trace = get_current_trace()
    if current_trace is not None:
        event["trace_id"] = current_trace.trace_id

    emit_local_observability_event(event)
