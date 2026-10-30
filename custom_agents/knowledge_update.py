"""Freshservice and Confluence Knowledge Update agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

# TODO: Import specialist guardrails
# from guardrails import ()

# TODO: Import specialist tools
from tools import (
    FreshserviceTicketId,
)


# TODO: Implement Knowledge Update Prompt
KNOWLEDGE_UPDATE_PROMPT = """
""".strip()


class KnowledgeUpdateOutput(BaseModel):
    """Structured output of the knowledge update specialist agent.
    Fields:
        ticket_id: Ticket supplied by the manager. (Type: FreshserviceTicketId)
        status: Whether the manager must save a recommendation note or knowledge processing is complete. (Type: Literal['recommendation_pending', 'knowledge_updated', 'failed'])
        trigger_type: Explicit human-outcome trigger supplied by the manager. (Type: Literal['resolution_confirmed', 'confirmation_timeout'])
        recommendation_article_id: Existing Freshservice article needing a private recommendation note, if any. (Type: str | None)
        recommendation_body: Proposed Freshservice article update including the article ID, supporting references and appropriate platform administrator @mention. (Type: str | None)
        drafted_comment: Additional review findings for the manager's private ticket note. (Type: str | None)
        evidence_references: Actual article, mapping, ticket and saved draft references supporting recommendations. (Type: list[str])
        confluence_draft_ids: Administrator-review draft IDs confirmed saved by the draft tool. (Type: list[str])
        proposed_tags: Complete proposed tag additions, including any pending recommendation tag. (Type: list[str])
        applied_tags: Tags confirmed persisted; empty when the manager must first save a note. (Type: list[str])
        errors: Verified tool errors or missing persisted human-outcome evidence. (Type: list[str])
        sources_used: Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed. (Type: list[Literal['freshservice_knowledge_base', 'confluence', 'ticket_history', 'applications_support_keywords']])
        confidence: Confidence in the returned decision, including no change or insufficient evidence, not unknown incident facts; below 0.90 stops for human review. (Type: float; Range: 0 to 1 inclusive)
        confidence_reason: Evidence and uncertainty supporting the confidence score. (Type: str)
    """
    pass  # TODO: Implement fields for KnowledgeUpdateOutput


def make_knowledge_update_agent() -> Agent:
    """Create the Freshservice and Confluence Knowledge Update specialist."""
    return Agent(
        name="Freshservice and Confluence Knowledge Update Agent",
        instructions=KNOWLEDGE_UPDATE_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
            # TODO: Add specialist tools
        ],
        input_guardrails=[], # TODO: Add specialist input guardrails
        output_guardrails=[], # TODO: Add specialist output guardrails
        output_type=KnowledgeUpdateOutput,
    )


knowledge_update_agent: Agent = make_knowledge_update_agent()
