"""Applications Platform Detection agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

# TODO: Import specialist guardrails
# from guardrails import ()

# TODO: Import specialist tools
from tools import (
    FreshserviceTicketId,
)


# TODO: Implement Platform Detection Prompt
PLATFORM_DETECTION_PROMPT = """
""".strip()


class RequesterReplyDraft(BaseModel):
    """Structured requester reply draft for the manager to send.
    Fields:
        subject: Subject for the manager's Freshservice requester reply. (Type: str)
        body: One requester-facing request for the missing incident facts. (Type: str)
    """
    pass  # TODO: Implement fields for RequesterReplyDraft


class PlatformDetectionOutput(BaseModel):
    """Structured output of the platform detection specialist agent.
    Fields:
        ticket_id: Ticket supplied by the manager. (Type: FreshserviceTicketId)
        status: Platform investigation result; waiting is an intermediate outcome. (Type: Literal['platform_assigned', 'waiting_for_information', 'manual_review', 'failed'])
        platform: Platform actually assigned, or null when assignment was not possible. (Type: Literal['Sitecore', 'Salesforce', 'Boomi', 'NetSuite'] | None)
        missing_information: Required incident facts absent from the current ticket. (Type: list[str])
        reply_draft: Missing-information reply for the manager to send; never sent by this agent. (Type: RequesterReplyDraft | None)
        drafted_comment: Findings and investigation steps for the manager to save as a private note, including retrieved Boomi log lines verbatim in fenced text code blocks with process IDs and log path/one-based line ranges when available. (Type: str | None)
        process_ids: Candidate process IDs investigated using retrieved documentation. (Type: list[str])
        execution_ids: All execution IDs actually retrieved and inspected; empty if none matched. (Type: list[str])
        evidence_references: Retrieved document/process/execution IDs and log path/one-based line references supporting findings. (Type: list[str])
        errors: Verified blocking errors; inconclusive evidence belongs in the drafted comment. (Type: list[str])
        sources_used: Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed. (Type: list[Literal['freshservice_knowledge_base', 'confluence', 'ticket_history', 'applications_support_keywords']])
        confidence: Confidence in the returned decision, including manual review, not an unknown platform; below 0.90 stops for human review. (Type: float; Range: 0 to 1 inclusive)
        confidence_reason: Evidence and uncertainty supporting the confidence score. (Type: str)
    """
    pass  # TODO: Implement fields for PlatformDetectionOutput


def make_platform_detection_agent() -> Agent:
    """Create the Applications Platform Detection specialist."""
    return Agent(
        name="Applications Platform Detection Agent",
        instructions=PLATFORM_DETECTION_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
            # TODO: Add specialist tools
        ],
        input_guardrails=[], # TODO: Add specialist input guardrails
        output_guardrails=[], # TODO: Add specialist output guardrails
        output_type=PlatformDetectionOutput,
    )


platform_detection_agent: Agent = make_platform_detection_agent()
