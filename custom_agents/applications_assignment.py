"""Freshservice Applications Assignment agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

from guardrails import (analysis_confidence_guardrail)

from tools import (
    FreshserviceTicketId, lookup_dependency_map_tool, 
    lookup_applications_support_keywords_tool, lookup_freshservice_knowledge_base_tool, update_ticket_classification_tool, update_ticket_platform_tool, get_acknowledgement_template_tool, lookup_freshservice_categories_tool, lookup_freshservice_historical_tickets_tool
)

APPLICATIONS_ASSIGNMENT_PROMPT = """
Persona: Service Desk Assignment Specialist

Goal: To identify applications support tickets and recommend assignment.

Knowledge:
Dependency Map
Freshservice Knowledge Base
Applications Support Keywords: (Document)
Classifications: Application Support, Infrastructure, Education
• QPR: Quality Performance Review
• CPD: Continued Professional Development
• etc...

Rules: 
• Always return a status flag indicating final results of ticket assignment.

Instructions:
1. Lookup Category and Sub-Category Options using the Lookup Freshservice Categories Tool.
2. Lookup Dependency Map and Applications Support Keywords using lookup tools (Lookup Dependency Map Tool and Lookup Applications Support Keywords Tool).
3. If ticket can be classified as Applications Support with high confidence, update the ticket classification using Update Ticket Classification Tool. Identify a recommended Category and Sub-Category from the available options. Return a drafted comment to the manager indicating classification reason, recommended Category and Sub-Category. End procedure. 
4. Lookup similar past tickets from Freshservice using Lookup Freshservice Knowledge Base Tool. This tool should return similar tickets from the Application Support Group.
5. If a similar ticket indicates a classification with high confidence, update the ticket classification using Update Ticket Classification Tool. If the ticket also indicates a platform classification with high confidence, update the ticket platform using the Update Ticket Platform Tool. Identify a recommended Category and Sub-Category from the available options. Summarize the old ticket (including ticket ID) and return a drafted comment to the manager that includes the summary, the Claissifcation reasons, the reccomended Category, and the Sub-Category. End procedure.
6. If we are unable to proceed to classification, end workflow and return manual review status.
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
    ticket_id: Annotated[FreshserviceTicketId, Field(
        description="Ticket supplied by the manager.",
    )]
    status: Annotated[ Literal['application_support_assigned', 'platform_assigned', 'manual_review', 'failed'], Field(
        description="Verified classification, platform routing or required human review.",
    )]
    classification: Annotated[ Literal['Application Support', 'Infrastructure', 'Education'] | None, Field(
        description="Classification actually saved, or null when undetermined.",
    )]
    platform: Annotated[Literal['Sitecore', 'Salesforce', 'Boomi', 'NetSuite'] | None, Field(
        description="Platform actually assigned, if any.",
    )]
    recommended_category: Annotated[str |None, Field(
        description="Recommended catalog Category; not a claim of a saved category change.",
    )]
    recommended_subcategory: Annotated[str |None, Field(
        description="Recommended catalog Sub-Category. ",
    )]
    drafted_comment: Annotated[str |None, Field(
        description=" Requester-independent private comment for the manager to save. ",
    )]
    historical_ticket_ids: Annotated[list[str], Field(
        description=" Historical ticket IDs actually retrieved and used as evidence. ",
    )]
    evidence_references: Annotated[list[str], Field(
        description=" Retrieved ticket, article or dependency-mapping references supporting the comment. ",
    )]
    errors: Annotated[list[str], Field(
    description= " Verified blocking tool errors; empty on success. ", 
  )]
    sources_used: Annotated[list[Literal['freshservice_knowledge_base', 'confluence', 'ticket_history', 'applications_support_keywords']], Field(
    description= " Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed. ", 
  )]
    confidence: Annotated[float, Field(ge=0,le=1,
    description= " Confidence in the returned decision, including manual review, not an unknown classification/platform; below 0.90 stops for human review. ", 
  )]
    confidence_reason: Annotated[str, Field(
    description= " Evidence and uncertainty supporting the confidence score. ", 
  )]


def make_applications_assignment_agent() -> Agent:
    """Create the Freshservice Applications Assignment specialist."""
    return Agent(
        name="Freshservice Applications Assignment Agent",
        instructions=APPLICATIONS_ASSIGNMENT_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
        lookup_dependency_map_tool, lookup_applications_support_keywords_tool, lookup_freshservice_knowledge_base_tool, update_ticket_classification_tool, update_ticket_platform_tool, get_acknowledgement_template_tool, lookup_freshservice_categories_tool, lookup_freshservice_historical_tickets_tool
        ],
        input_guardrails=[],
        output_guardrails=[analysis_confidence_guardrail],
        output_type=ApplicationsAssignmentOutput,
    )


applications_assignment_agent: Agent = make_applications_assignment_agent()
