"""Retrieve complete synthetic Boomi execution logs correlated to an incident."""

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from agents import function_tool
from pydantic import AwareDatetime, BaseModel, Field

from guardrails import tool_prompt_injection_and_malware_guardrail

from . import helpers
from .helpers import RecordNotFound

BOOMI_PROCESSES = {
    "proc-e1a2b3c4": "EmploymentUpdateListener",
    "proc-h4d5e6f7": "ContactDetailsSyncProcess",
    "proc-k7g8h9i0": "Listener - ecr Order Update",
    "proc-f2b3c4d5": "MembershipRenewalOrchestrator",
    "proc-g3c4d5e6": "EventRegistrationSync",
    "proc-i5e6f7g8": "CPDDeclarationIngestion",
    "proc-j6f7g8h9": "MemberFeedbackRouter",
}
BOOMI_EXECUTIONS_FILE = "boomi_logs/execution_records.json"
LOG_WINDOW_MINUTES = 5


class BoomiLogExcerpt(BaseModel):
    log_path: str
    start_line: int
    end_line: int
    lines: list[str]


class BoomiExecutionRecord(BaseModel):
    execution_id: str
    process_id: str
    process_name: str
    execution_time: AwareDatetime
    execution_duration_ms: Annotated[int, Field(ge=0)]
    status: Literal["COMPLETE", "COMPLETE_WARN", "ERROR", "ABORTED"]
    atom_id: str
    atom_name: str


class BoomiDocumentMatch(BaseModel):
    document_id: Annotated[str, Field(min_length=1)]
    identity_line: Annotated[
        int, Field(ge=1, description="One-based line logging the matched identity.")
    ]


class BoomiExecutionLog(BaseModel):
    record: BoomiExecutionRecord
    matched_documents: list[BoomiDocumentMatch]
    log: BoomiLogExcerpt


class BoomiQuery(BaseModel):
    process_id: str
    incident_timestamp: AwareDatetime
    window_start: AwareDatetime
    window_end: AwareDatetime
    customer_id: str | None = None
    member_id: str | None = None
    customer_email: str | None = None
    customer_name: str | None = None


class BoomiInspectionResult(BaseModel):
    query: BoomiQuery
    executions: list[BoomiExecutionLog]


def _normalize(value: str) -> str:
    return " ".join(value.split()).casefold()


@function_tool(tool_output_guardrails=[tool_prompt_injection_and_malware_guardrail])
def inspect_boomi_log_tool(
    process_id: str,
    incident_timestamp: AwareDatetime,
    customer_id: str | None = None,
    member_id: str | None = None,
    customer_email: str | None = None,
    customer_name: str | None = None,
) -> BoomiInspectionResult:
    """Retrieve complete matching execution logs, including shared batch context.

    Args:
        process_id: Boomi process ID identified from Confluence document text.
        incident_timestamp: Timezone-aware approximate incident time. Executions
            overlapping the inclusive five minutes before/after it are candidates.
        customer_id: Affected customer ID, if available.
        member_id: Affected member ID, if available.
        customer_email: Affected email, if available.
        customer_name: Affected full name, if available.

    Returns:
        Query and all matching execution records with complete five-column logs,
        matched document IDs and identity-line references. All supplied identifiers
        must match one logged document context after case/space normalization.
        Batch logs retain other customers; no status or error filtering is applied.
        No match returns an empty executions list.
    """
    identifiers = {
        key: _normalize(value)
        for key, value in {
            "customerId": customer_id,
            "memberId": member_id,
            "email": customer_email,
            "customerName": customer_name,
        }.items()
        if value and value.strip()
    }
    if not identifiers:
        raise ValueError("At least one affected-person identifier is required.")
    if process_id not in BOOMI_PROCESSES:
        raise RecordNotFound(f"Unknown process: {process_id}")

    incident_time = incident_timestamp.astimezone(UTC)
    window = timedelta(minutes=LOG_WINDOW_MINUTES)
    query = BoomiQuery(
        process_id=process_id,
        incident_timestamp=incident_timestamp,
        window_start=incident_time - window,
        window_end=incident_time + window,
        customer_id=customer_id,
        member_id=member_id,
        customer_email=customer_email,
        customer_name=customer_name,
    )
    executions: list[BoomiExecutionLog] = []
    for item in helpers.read_store(BOOMI_EXECUTIONS_FILE)["executions"]:
        if item["process_id"] != process_id:
            continue
        record = BoomiExecutionRecord.model_validate(item)
        end_time = record.execution_time + timedelta(
            milliseconds=record.execution_duration_ms
        )
        if record.execution_time > query.window_end or end_time < query.window_start:
            continue

        log_path = item["log_path"]
        path = (helpers.RUNTIME_DIR / log_path).resolve()
        if not path.is_relative_to((helpers.RUNTIME_DIR / "boomi_logs").resolve()):
            raise ValueError("Execution log path is outside the runtime Boomi directory.")
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines:
            raise ValueError(f"Empty execution log: {record.execution_id}")
        matches: list[BoomiDocumentMatch] = []
        for number, line in enumerate(lines, 1):
            timestamp, _, shape, _, message = line.split("\t", 4)
            if datetime.fromisoformat(timestamp).tzinfo is None:
                raise ValueError(f"Log timestamp must be timezone-aware at line {number}.")
            # These fixtures use a custom Notify step to log document identity.
            # This is process instrumentation, not a standard Boomi identity field.
            if shape != "Document context":
                continue
            context = json.loads(message)
            if all(
                _normalize(context.get(key, "")) == value
                for key, value in identifiers.items()
            ):
                matches.append(
                    BoomiDocumentMatch(
                        document_id=context["documentId"], identity_line=number
                    )
                )
        if matches:
            executions.append(
                BoomiExecutionLog(
                    record=record,
                    matched_documents=matches,
                    log=BoomiLogExcerpt(
                        log_path=log_path, start_line=1, end_line=len(lines), lines=lines
                    ),
                )
            )
    executions.sort(
        key=lambda execution: (
            execution.record.execution_time, execution.record.execution_id
        )
    )
    return BoomiInspectionResult(query=query, executions=executions)
