"""FastAPI API for CAANZ triggers, requester emails and saved/custom scenarios.

Run locally (one worker against the shared local fixtures):
    uv run uvicorn api:app --reload

Open docs:
    http://localhost:8000/docs

Send a ticket for triage:
    curl -X POST "http://localhost:8000/agents/run" \
      -H "Content-Type: application/json" \
      -d '{"trigger_type":"new_ticket","ticket_id":"FS-1001"}'
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Coroutine
from copy import deepcopy
from typing import Annotated, Any, Literal, Self

from agents import (
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
    ToolInputGuardrailTripwireTriggered,
    ToolOutputGuardrailTripwireTriggered,
)
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from custom_agents import ManagerOutput
from main import (
    get_scenario_payloads,
    load_scenarios,
    prepare_scenario_payload,
    run_scenario_inputs,
)
from scripts.reset_runtime_data import STORE_DATA_DIR, restore_runtime_data
from tools import (
    FreshserviceMessage,
    FreshserviceNote,
    FreshserviceTicket,
    FreshserviceTicketId,
    RecordNotFound,
    read_store,
)
from tools.freshservice import TICKETS_FILE

WORKFLOW_STREAM_HEARTBEAT_SECONDS = 15.0
RUNTIME_OPERATION_LOCK = asyncio.Lock()
TRIGGER_EXAMPLE = {"trigger_type": "new_ticket", "ticket_id": "FS-1001"}
SCENARIO_EXAMPLE = {"scenario_id": "happy_path"}

app = FastAPI(
    title="CAANZ Workflow API",
    description=(
        "Run structured CAANZ triggers and saved/custom scenarios over local "
        "Freshservice, Confluence and Boomi fixtures. Conversations are embedded "
        "on tickets. Prompt-injection and 90% confidence guardrails are attached. "
        "External intake, prose fact extraction and human approval are not implemented."
    ),
)


class EmailContent(BaseModel):
    """Requester email; omitted timestamps are generated at dispatch."""

    model_config = ConfigDict(extra="forbid")

    timestamp: Annotated[
        AwareDatetime | None,
        Field(default=None, description="Email time with timezone; generated when omitted."),
    ]
    from_address: Annotated[str, Field(alias="from", min_length=1)]
    to: Annotated[list[str], Field(min_length=1)]
    cc: Annotated[list[str], Field(default_factory=list)]
    subject: Annotated[str, Field(min_length=1)]
    body: Annotated[str, Field(min_length=1)]


class ScenarioNote(FreshserviceNote):
    """Private-note input whose missing timestamp is filled by the runner."""

    timestamp: AwareDatetime | None = None


class ScenarioMessage(FreshserviceMessage):
    """Conversation input whose missing timestamp is filled by the runner."""

    timestamp: AwareDatetime | None = None


class TicketUpdate(BaseModel):
    """Trusted local fixture changes applied before dispatch, never sent to agents."""

    model_config = ConfigDict(extra="forbid")

    ticket_changes: Annotated[dict[str, Any], Field(default_factory=dict)]
    append_private_notes: Annotated[list[ScenarioNote], Field(default_factory=list)]
    append_conversation: Annotated[list[ScenarioMessage], Field(default_factory=list)]


class TriggerPayload(BaseModel):
    """One event referencing an existing Freshservice ticket."""

    model_config = ConfigDict(extra="forbid")

    trigger_type: Literal[
        "new_ticket", "requester_update", "resolution_confirmed", "confirmation_timeout"
    ]
    ticket_id: FreshserviceTicketId
    email_content: EmailContent | None = None
    ticket_update: TicketUpdate | None = None

    @model_validator(mode="after")
    def validate_email_trigger(self) -> Self:
        if self.trigger_type == "requester_update" and self.email_content is None:
            raise ValueError("Requester updates require email_content.")
        if self.trigger_type != "requester_update" and self.email_content is not None:
            raise ValueError("Only requester_update accepts email_content.")
        return self


class AgenticWorkflowRunRequest(TriggerPayload):
    """One current-runtime event with optional trace and session continuity."""

    trace_id: Annotated[str | None, Field(default=None, pattern=r"^trace_[0-9a-f]{32}$")]
    session_id: Annotated[str | None, Field(default=None, min_length=1)]


class ScenarioOption(BaseModel):
    id: str
    description: str
    payloads: list[TriggerPayload]


class ScenarioListResponse(BaseModel):
    scenarios: list[ScenarioOption]


class ScenarioRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: Annotated[str, Field(min_length=1)]


class CustomScenarioRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payloads: Annotated[list[TriggerPayload], Field(min_length=1)]


class RunContextResponse(BaseModel):
    """Current ticket and its embedded conversation; no standalone email IDs."""

    ticket_id: FreshserviceTicketId
    ticket: FreshserviceTicket
    conversation: list[FreshserviceMessage]


class AgenticWorkflowRunResponse(RunContextResponse):
    """Final Manager output and persisted local ticket context."""

    workflow_output: ManagerOutput
    input_payload: dict[str, Any] | list[dict[str, Any]]
    trace_id: str
    session_id: str | None
    scenario_name: str | None = None
    scenario_id: str | None = None
    status: Annotated[
        Literal[
            "platform_assigned", "waiting_for_information", "manual_review",
            "knowledge_updated", "failed",
        ],
        Field(description="Manager workflow result, separate from ticket.status."),
    ]


class RuntimeResetResponse(BaseModel):
    status: Literal["restored"]
    restored_files: int


def _workflow_http_exception(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, InputGuardrailTripwireTriggered):
        return HTTPException(
            status_code=422,
            detail="Prompt injection detected; automated processing stopped.",
        )
    if isinstance(exc, ToolOutputGuardrailTripwireTriggered):
        return HTTPException(
            status_code=409,
            detail="Prompt injection detected in tool content; automated processing stopped.",
        )
    if isinstance(
        exc, (OutputGuardrailTripwireTriggered, ToolInputGuardrailTripwireTriggered)
    ):
        return HTTPException(
            status_code=409,
            detail=(
                "Confidence below 90% or invalid; automated processing stopped. "
                "Human review required."
            ),
        )
    if isinstance(exc, RecordNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ValueError, ValidationError)):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=f"Workflow execution failed: {exc}")


def _payload_dict(payload: TriggerPayload) -> dict[str, Any]:
    return payload.model_dump(
        mode="json", by_alias=True, exclude_none=True,
        exclude={"trace_id", "session_id"},
    )


def _read_context(ticket_id: str) -> RunContextResponse:
    entry = read_store(TICKETS_FILE)["tickets"].get(ticket_id)
    if entry is None:
        raise RecordNotFound(f"Unknown ticket: {ticket_id}")
    ticket = FreshserviceTicket.model_validate(entry["ticket"])
    return RunContextResponse(
        ticket_id=ticket_id, ticket=ticket, conversation=ticket.conversation,
    )


def _validate_payloads(payloads: list[dict[str, Any]], *, baseline: bool) -> None:
    # Preflight the entire sequence without writes or resets. Actual mutations
    # remain owned by main.handle_scenario_payload and the fixture helpers.
    if baseline:
        store = json.loads((STORE_DATA_DIR / TICKETS_FILE).read_text(encoding="utf-8"))
    else:
        store = read_store(TICKETS_FILE)
    tickets = deepcopy(store["tickets"])
    active_ticket_id: str | None = None
    for payload in payloads:
        payload = prepare_scenario_payload(payload)
        event = TriggerPayload.model_validate(payload)
        if active_ticket_id is not None and active_ticket_id != event.ticket_id:
            raise ValueError("Payloads cannot switch ticket IDs within a scenario.")
        active_ticket_id = event.ticket_id
        if event.ticket_id not in tickets:
            raise RecordNotFound(f"Unknown ticket: {event.ticket_id}")
        ticket = tickets[event.ticket_id]["ticket"]
        update = payload.get("ticket_update", {})
        changes = update.get("ticket_changes", {})
        unknown = changes.keys() - FreshserviceTicket.model_fields.keys()
        if unknown:
            raise ValueError(f"Unknown ticket fields: {', '.join(sorted(unknown))}")
        ticket.update(changes)
        FreshserviceTicket.model_validate(ticket)
        ticket["private_notes"].extend(update.get("append_private_notes", []))
        ticket["conversation"].extend(update.get("append_conversation", []))
        if ticket["id"] != event.ticket_id:
            raise ValueError("A ticket update cannot change the ticket ID.")
        if event.email_content is not None:
            email = event.email_content
            message = FreshserviceMessage(
                ticket_id=event.ticket_id, direction="inbound", timestamp=email.timestamp,
                from_address=email.from_address, to=email.to, cc=email.cc,
                subject=email.subject, body=email.body,
            )
            ticket["conversation"].append(message.model_dump(mode="json"))
        FreshserviceTicket.model_validate(ticket)


def _prepare_payloads(payloads: list[dict[str, Any]], *, baseline: bool) -> None:
    try:
        _validate_payloads(payloads, baseline=baseline)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read local fixtures: {exc}") from exc
    except (ValueError, ValidationError) as exc:
        raise _workflow_http_exception(exc) from exc


def _scenario_payloads(request: ScenarioRunRequest) -> list[dict[str, Any]]:
    try:
        scenarios = load_scenarios()
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not load scenarios: {exc}") from exc
    scenario = scenarios.get(request.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {request.scenario_id}")
    payloads = get_scenario_payloads(scenario)
    if not payloads:
        raise HTTPException(status_code=422, detail="Scenario has no payloads.")
    _prepare_payloads(payloads, baseline=True)
    return payloads


def _require_idle_runtime() -> None:
    if RUNTIME_OPERATION_LOCK.locked():
        raise HTTPException(
            status_code=409,
            detail="A workflow or runtime reset is already running.",
        )


async def _execute_payloads(
    payloads: list[dict[str, Any]],
    *,
    reset: bool,
    scenario_name: str | None = None,
    scenario_id: str | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
    single_payload: bool = False,
) -> AgenticWorkflowRunResponse:
    _require_idle_runtime()
    async with RUNTIME_OPERATION_LOCK:
        _prepare_payloads(payloads, baseline=reset)
        try:
            if reset:
                restore_runtime_data()
            output, _, trace_id, session_id, manager_payload = await run_scenario_inputs(
                payloads, scenario_name=scenario_name, trace_id=trace_id,
                session_id=session_id,
            )
            context = _read_context(manager_payload["ticket_id"])
            return AgenticWorkflowRunResponse(
                **context.model_dump(), workflow_output=output,
                input_payload=payloads[0] if single_payload else payloads,
                trace_id=trace_id, session_id=session_id,
                scenario_name=scenario_name, scenario_id=scenario_id,
                status=output.status,
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=f"Local runtime failure: {exc}") from exc
        except Exception as exc:
            # This is the request boundary: preserve the error as a failed HTTP
            # response (or SSE error), never as a successful workflow result.
            raise _workflow_http_exception(exc) from exc


def _encode_workflow_stream_event(event: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {data}\n\n"


async def _stream_workflow(
    run_factory: Callable[[], Coroutine[Any, Any, AgenticWorkflowRunResponse]],
) -> AsyncIterator[str]:
    task = asyncio.create_task(run_factory())
    try:
        yield _encode_workflow_stream_event("connected", {"type": "connected"})
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=WORKFLOW_STREAM_HEARTBEAT_SECONDS)
            if not done:
                yield _encode_workflow_stream_event("heartbeat", {"type": "heartbeat"})
        try:
            result = task.result()
        except Exception as exc:
            error = _workflow_http_exception(exc)
            yield _encode_workflow_stream_event("error", {
                "type": "error", "status_code": error.status_code,
                "error": str(error.detail), "detail": error.detail,
            })
        else:
            yield _encode_workflow_stream_event("result", {
                "type": "result", "result": result.model_dump(mode="json"),
            })
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def _workflow_streaming_response(
    run_factory: Callable[[], Coroutine[Any, Any, AgenticWorkflowRunResponse]],
) -> StreamingResponse:
    return StreamingResponse(
        _stream_workflow(run_factory), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/", tags=["health"])
async def read_root() -> dict[str, str]:
    """Confirm the service is alive without reading or resetting fixtures."""
    return {"service": "caanz-workflow-service", "status": "ok"}


@app.post("/runtime/reset", tags=["runtime"], response_model=RuntimeResetResponse)
async def reset_runtime_endpoint() -> RuntimeResetResponse:
    """Restore local fixtures when no API workflow is running."""
    _require_idle_runtime()
    async with RUNTIME_OPERATION_LOCK:
        try:
            restored = restore_runtime_data()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    return RuntimeResetResponse(status="restored", restored_files=len(restored))


@app.get("/runs/context", tags=["agents"], response_model=RunContextResponse)
async def read_run_context_endpoint(
    ticket_id: Annotated[str, Query(pattern=r"^FS-\d+$")],
) -> RunContextResponse:
    """Read a ticket's current fields, private notes and embedded conversation."""
    try:
        return _read_context(ticket_id)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read local runtime: {exc}") from exc
    except ValueError as exc:
        raise _workflow_http_exception(exc) from exc


@app.post("/agents/run", tags=["agents"], response_model=AgenticWorkflowRunResponse)
async def run_agents_endpoint(
    request: Annotated[AgenticWorkflowRunRequest, Body(examples=[TRIGGER_EXAMPLE])],
) -> AgenticWorkflowRunResponse:
    """Execute one structured trigger without resetting existing runtime state."""
    return await _execute_payloads(
        [_payload_dict(request)], reset=False, trace_id=request.trace_id,
        session_id=request.session_id, single_payload=True,
    )


@app.post("/agents/run/stream", tags=["agents"], response_class=StreamingResponse)
async def stream_agents_endpoint(
    request: Annotated[AgenticWorkflowRunRequest, Body(examples=[TRIGGER_EXAMPLE])],
) -> StreamingResponse:
    """Execute one current-runtime trigger with lifecycle SSE events."""
    _require_idle_runtime()
    payloads = [_payload_dict(request)]
    _prepare_payloads(payloads, baseline=False)
    return _workflow_streaming_response(lambda: _execute_payloads(
        payloads, reset=False, trace_id=request.trace_id,
        session_id=request.session_id, single_payload=True,
    ))


@app.get(
    "/scenarios", tags=["scenarios"], response_model=ScenarioListResponse,
    response_model_exclude_unset=True,
)
async def list_scenarios_endpoint() -> ScenarioListResponse:
    """List scenario previews without exposing expected answers to the Manager."""
    try:
        scenarios = load_scenarios()
        return ScenarioListResponse(scenarios=[
            ScenarioOption(id=key, description=scenario.get("description", ""),
                           payloads=get_scenario_payloads(scenario))
            for key, scenario in scenarios.items()
        ])
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not load scenarios: {exc}") from exc


@app.post("/scenarios/run", tags=["scenarios"], response_model=AgenticWorkflowRunResponse)
async def run_scenario_endpoint(
    request: Annotated[ScenarioRunRequest, Body(examples=[SCENARIO_EXAMPLE])],
) -> AgenticWorkflowRunResponse:
    """Reset once and run the saved scenario's ordered payloads in one session."""
    return await _execute_payloads(
        _scenario_payloads(request), reset=True,
        scenario_name=request.scenario_id, scenario_id=request.scenario_id,
    )


@app.post("/scenarios/run/stream", tags=["scenarios"], response_class=StreamingResponse)
async def stream_scenario_endpoint(
    request: Annotated[ScenarioRunRequest, Body(examples=[SCENARIO_EXAMPLE])],
) -> StreamingResponse:
    """Preflight a saved scenario and stream its reset and execution."""
    _require_idle_runtime()
    payloads = _scenario_payloads(request)
    return _workflow_streaming_response(lambda: _execute_payloads(
        payloads, reset=True, scenario_name=request.scenario_id,
        scenario_id=request.scenario_id,
    ))


@app.post("/scenarios/run/custom", tags=["scenarios"], response_model=AgenticWorkflowRunResponse)
async def run_custom_scenario_endpoint(
    request: CustomScenarioRunRequest,
) -> AgenticWorkflowRunResponse:
    """Reset once and run validated custom payloads for one baseline ticket."""
    return await _execute_payloads(
        [_payload_dict(p) for p in request.payloads], reset=True,
        scenario_name="custom_payload",
    )


@app.post("/scenarios/run/custom/stream", tags=["scenarios"], response_class=StreamingResponse)
async def stream_custom_scenario_endpoint(
    request: CustomScenarioRunRequest,
) -> StreamingResponse:
    """Preflight custom payloads and stream their reset and execution."""
    _require_idle_runtime()
    payloads = [_payload_dict(p) for p in request.payloads]
    _prepare_payloads(payloads, baseline=True)
    return _workflow_streaming_response(lambda: _execute_payloads(
        payloads, reset=True, scenario_name="custom_payload",
    ))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
