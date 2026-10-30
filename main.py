import argparse
import asyncio
import json
import uuid
from contextlib import nullcontext
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agents import Runner, SQLiteSession, trace
from dotenv import load_dotenv

from custom_agents import make_manager_agent
from scripts.reset_runtime_data import restore_runtime_data
from tools import (
    FreshserviceMessage,
    FreshserviceTicket,
    RecordNotFound,
    fixture_lock,
    read_store,
    write_store,
)
from tools.freshservice import TICKETS_FILE
from utils import (
    TelemetryRunHook,
    emit_execution_summary,
    setup_run_hooks,
    setup_tracing,
)

AGENT_MAX_TURNS = 50
SCENARIOS_PATH = Path(__file__).parent / "data" / "scenarios.json"
DEFAULT_SCENARIO = "happy_path"
SESSION_DB: dict[str, SQLiteSession] = dict()
TRIGGER_TYPES = (
    "new_ticket",
    "requester_update",
    "resolution_confirmed",
    "confirmation_timeout",
)
load_dotenv(override=True)


def prepare_scenario_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Copy an event and fill missing event times when it is applied."""
    payload = deepcopy(payload)
    timestamp = datetime.now(UTC).isoformat()
    email = payload.get("email_content")
    if isinstance(email, dict) and email.get("timestamp") is None:
        email["timestamp"] = timestamp
    update = payload.get("ticket_update", {})
    for field in ("append_private_notes", "append_conversation"):
        for record in update.get(field, []):
            if record.get("timestamp") is None:
                record["timestamp"] = timestamp
    changes = update.get("ticket_changes", {})
    resolution = changes.get("resolution")
    if isinstance(resolution, dict):
        resolution.setdefault("resolved_at", timestamp)
        resolution.setdefault(
            "confirmed_at",
            timestamp if resolution.get("confirmation_outcome") == "resolved" else None,
        )
        resolution.setdefault(
            "closed_at", timestamp if changes.get("status") == "Closed" else None
        )
    return payload


def build_manager_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and copy only the trigger, ticket ID and requester email."""
    trigger_type = payload.get("trigger_type")
    if trigger_type not in TRIGGER_TYPES:
        raise ValueError(f"Unknown trigger type: {trigger_type}")
    ticket_id = payload.get("ticket_id")
    if not isinstance(ticket_id, str) or not ticket_id.strip():
        raise ValueError("Payloads require an existing ticket ID.")
    manager_payload = {"trigger_type": trigger_type, "ticket_id": ticket_id}
    if trigger_type == "requester_update":
        email_content = payload.get("email_content")
        if not isinstance(email_content, dict):
            raise ValueError("Requester updates must include an email_content object.")
        manager_payload["email_content"] = deepcopy(email_content)
    return manager_payload


async def run_workflow(
    payload: dict[str, Any],
    run_hooks: TelemetryRunHook | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
    scenario_name: str | None = None,
) -> tuple[Any, TelemetryRunHook, str, str | None]:
    """Run a structured trigger payload through the manager agent."""
    manager_payload = build_manager_payload(payload)
    return await _run_manager_input(
        json.dumps(manager_payload),
        run_hooks=run_hooks,
        trace_id=trace_id,
        session_id=session_id,
        scenario_name=scenario_name,
        input_label=f"Payload: {json.dumps(manager_payload)}",
    )


async def _run_manager_input(
    agent_input: str,
    run_hooks: TelemetryRunHook | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
    scenario_name: str | None = None,
    input_label: str | None = None,
) -> tuple[Any, TelemetryRunHook, str, str | None]:
    run_hooks = run_hooks or setup_run_hooks(verbose=False)
    session_id = session_id or uuid.uuid4().hex
    workflow_name = f"Workflow - {scenario_name}" if scenario_name else "Workflow"
    if trace_id is None:
        trace_id, _ = setup_tracing()

    if session_id in SESSION_DB:
        session = SESSION_DB[session_id]
    else:
        session = SQLiteSession(session_id=session_id)
        SESSION_DB[session_id] = session

    manager_agent = make_manager_agent(hooks=run_hooks)

    print(f"[Run] {input_label or f'Agent input: {agent_input}'}")
    print(f"[Run] Workflow name: {workflow_name}")
    print(f"[Run] Session: {session.session_id}")
    print("[Run] Dispatching to Manager agent...\n")

    with trace(workflow_name=workflow_name, trace_id=trace_id):
        result = await Runner().run(
            starting_agent=manager_agent,
            input=agent_input,
            hooks=run_hooks,
            session=session,
            max_turns=AGENT_MAX_TURNS,
        )
    output = result.final_output
    print(output)

    return output, run_hooks, trace_id, session_id


def handle_scenario_payload(
    payload: dict[str, Any],
    active_ticket_id: str | None,
) -> tuple[dict[str, Any], str]:
    """Apply one trusted scenario event before dispatching its trigger context."""
    payload = prepare_scenario_payload(payload)
    manager_payload = build_manager_payload(payload)
    ticket_id = manager_payload["ticket_id"]
    if active_ticket_id is not None and ticket_id != active_ticket_id:
        raise ValueError(
            f"A scenario cannot switch ticket IDs: {active_ticket_id} to {ticket_id}."
        )

    update = payload.get("ticket_update", {})
    email_content = manager_payload.get("email_content")

    needs_update = bool(update) or email_content is not None
    with (fixture_lock() if needs_update else nullcontext()):
        store = read_store(TICKETS_FILE)
        if ticket_id not in store["tickets"]:
            raise RecordNotFound(f"Unknown ticket: {ticket_id}")
        ticket = store["tickets"][ticket_id]["ticket"]
        ticket.update(update.get("ticket_changes", {}))
        ticket["private_notes"].extend(update.get("append_private_notes", []))
        ticket["conversation"].extend(update.get("append_conversation", []))
        if email_content is not None:
            message = FreshserviceMessage(
                ticket_id=ticket_id,
                direction="inbound",
                timestamp=email_content["timestamp"],
                from_address=email_content["from"],
                to=email_content["to"],
                cc=email_content.get("cc", []),
                subject=email_content["subject"],
                body=email_content["body"],
            )
            ticket["conversation"].append(message.model_dump(mode="json"))
        if ticket["id"] != ticket_id:
            raise ValueError("A ticket update cannot change the ticket ID.")
        FreshserviceTicket.model_validate(ticket)
        if needs_update:
            write_store(TICKETS_FILE, store)

    print(f"[Run] Active ticket: {ticket_id} (status={ticket['status']})")
    return manager_payload, ticket_id


async def run_scenario_inputs(
    payloads: list[dict[str, Any]],
    scenario_name: str | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
) -> tuple[Any, TelemetryRunHook, str, str | None, dict[str, Any]]:
    """Run related payloads in one traced session and return the final run context."""
    if not payloads:
        raise ValueError("At least one scenario payload is required.")

    run_hooks = setup_run_hooks(verbose=False)
    session_id = session_id or uuid.uuid4().hex
    if trace_id is None:
        trace_id, _ = setup_tracing()
    ticket_id: str | None = None
    output: Any = None
    manager_payload: dict[str, Any] = {}

    try:
        for index, payload in enumerate(payloads, start=1):
            print(f"[Run] Payload {index}/{len(payloads)}")
            manager_payload, ticket_id = handle_scenario_payload(payload, ticket_id)
            output, _, _, _ = await run_workflow(
                payload=manager_payload,
                run_hooks=run_hooks,
                trace_id=trace_id,
                session_id=session_id,
                scenario_name=scenario_name,
            )
            # These are trigger outcomes; only failure cancels later external events.
            if output.status == "failed":
                break
    finally:
        run_hooks.mark_trace_complete(trace_id)
        emit_execution_summary(run_hooks.export_summary())
    return output, run_hooks, trace_id, session_id, manager_payload


def get_scenario_payloads(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    """Return scenario payloads."""
    payloads = scenario.get("payloads")
    if isinstance(payloads, list):
        return payloads

    return []


def load_scenarios() -> dict[str, dict[str, Any]]:
    """Load scenarios keyed by their identifier."""
    with SCENARIOS_PATH.open(encoding="utf-8") as scenarios_file:
        scenarios_data = json.load(scenarios_file)

    return {
        scenario["id"]: scenario
        for scenario in scenarios_data.get("scenarios", [])
        if isinstance(scenario, dict) and isinstance(scenario.get("id"), str)
    }


async def run_all_scenarios(
    scenarios: dict[str, dict[str, Any]],
) -> list[tuple[str, str]]:
    """Run every scenario sequentially and return any failures."""
    failures: list[tuple[str, str]] = []

    for index, (scenario_id, scenario) in enumerate(scenarios.items(), start=1):
        print(
            f"\n[Batch] Running scenario {index}/{len(scenarios)}: {scenario_id}",
            flush=True,
        )
        try:
            restore_runtime_data()
            payloads = get_scenario_payloads(scenario)
            if not payloads:
                raise ValueError(f"Scenario '{scenario_id}' has no payloads to run.")

            output, _, _, _, _ = await run_scenario_inputs(payloads, scenario_id)
        except Exception as exc:
            failure = f"{type(exc).__name__}: {exc}"
            failures.append((scenario_id, failure))
            print(f"[Batch] Scenario failed: {scenario_id}: {failure}")
            continue

        if getattr(output, "status", None) == "failed":
            errors = getattr(output, "errors", [])
            failure = "; ".join(errors) or "Manager returned failed."
            failures.append((scenario_id, failure))
            print(f"[Batch] Scenario failed: {scenario_id}: {failure}")

    if failures:
        print("\n[Batch] Scenario failures:")
        for scenario_id, failure in failures:
            print(f"- {scenario_id}: {failure}")
    else:
        print(f"\n[Batch] Finished all {len(scenarios)} scenarios.")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the agentic workflow.")
    parser.add_argument(
        "--scenario",
        help=(
            "Scenario ID from scenarios.json, or 'all' to run every scenario "
            "sequentially from fresh fixtures. Defaults to "
            f"{DEFAULT_SCENARIO}."
        ),
    )
    parser.add_argument(
        "--list_scenarios",
        action="store_true",
        help="List available scenario IDs and exit.",
    )
    args = parser.parse_args()

    # Load scenarios from data/scenarios.json.
    try:
        scenarios = load_scenarios()
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Error: Unable to load {SCENARIOS_PATH}: {exc}")
        return 1

    if not scenarios:
        print(f"Error: No scenarios found in {SCENARIOS_PATH}.")
        return 1

    if args.list_scenarios:
        print("Available scenarios:")
        for scenario_id, scenario in scenarios.items():
            description = scenario.get("description", "No description provided.")
            print(f"- {scenario_id}: {description}")
        return 0

    scenario_id = args.scenario or DEFAULT_SCENARIO
    if scenario_id == "all":
        failures = asyncio.run(run_all_scenarios(scenarios))
        return int(bool(failures))

    if scenario_id not in scenarios:
        print(
            f"Error: Scenario '{scenario_id}' not found. "
            f"Available: {', '.join(scenarios.keys())}"
        )
        return 1

    scenario = scenarios[scenario_id]
    print(f"[Run] Loading scenario: {scenario['id']} ({scenario['description']})")

    payloads = get_scenario_payloads(scenario)
    if not payloads:
        print(f"Error: Scenario '{scenario['id']}' has no payloads to run.")
        return 1

    try:
        restore_runtime_data()
        output, _, _, _, _ = asyncio.run(run_scenario_inputs(payloads, scenario["id"]))
    except Exception as exc:
        print(f"Error: {type(exc).__name__}: {exc}")
        return 1
    return int(output.status == "failed")


if __name__ == "__main__":
    raise SystemExit(main())
