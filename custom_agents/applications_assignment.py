"""Freshservice Applications Assignment agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

# TODO: Import specialist guardrails
# from guardrails import ()

# TODO: Import specialist tools
from tools import (
    FreshserviceTicketId,
)


# TODO: Implement Applications Assignment Prompt
APPLICATIONS_ASSIGNMENT_PROMPT = """
""".strip()


class ApplicationsAssignmentOutput(BaseModel):
    """Structured output of the applications assignment specialist agent.
    Fields:
        ticket_id: Ticket supplied by the manager. (Type: FreshserviceTicketId)
        status: Verified classification, platform routing or required human review. (Type: Literal['application_support_assigned', 'platform_assigned', 'manual_review', 'failed'])
        classification: Classification actually saved, or null when undetermined. (Type: Literal['Application Support', 'Infrastructure', 'Education'] | None)
        platform: Platform actually assigned, if any. (Type: Literal['Sitecore', 'Salesforce', 'Boomi', 'NetSuite'] | None)
        recommended_category: Recommended catalog Category; not a claim of a saved category change. (Type: str | None)
        recommended_subcategory: Recommended catalog Sub-Category. (Type: str | None)
        drafted_comment: Requester-independent private comment for the manager to save. (Type: str | None)
        historical_ticket_ids: Historical ticket IDs actually retrieved and used as evidence. (Type: list[str])
        evidence_references: Retrieved ticket, article or dependency-mapping references supporting the comment. (Type: list[str])
        errors: Verified blocking tool errors; empty on success. (Type: list[str])
        sources_used: Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed. (Type: list[Literal['freshservice_knowledge_base', 'confluence', 'ticket_history', 'applications_support_keywords']])
        confidence: Confidence in the returned decision, including manual review, not an unknown classification/platform; below 0.90 stops for human review. (Type: float; Range: 0 to 1 inclusive)
        confidence_reason: Evidence and uncertainty supporting the confidence score. (Type: str)
    """
    pass  # TODO: Implement fields for ApplicationsAssignmentOutput


def make_applications_assignment_agent() -> Agent:
    """Create the Freshservice Applications Assignment specialist."""
    return Agent(
        name="Freshservice Applications Assignment Agent",
        instructions=APPLICATIONS_ASSIGNMENT_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
            # TODO: Add specialist tools
        ],
        input_guardrails=[], # TODO: Add specialist input guardrails
        output_guardrails=[], # TODO: Add specialist output guardrails
        output_type=ApplicationsAssignmentOutput,
    )


applications_assignment_agent: Agent = make_applications_assignment_agent()
