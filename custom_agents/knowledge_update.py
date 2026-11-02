"""Freshservice and Confluence Knowledge Update agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

# TODO: Import specialist guardrails
# from guardrails import ()

# TODO: Import specialist tools
from tools import (
    FreshserviceTicketId,
    lookup_dependency_map_tool, 
    lookup_freshservice_knowledge_base_tool,
    create_confluence_draft_tool,
    lookup_freshservice_tags_tool,
    update_freshservice_ticket_tags_tool
)


# TODO: Implement Knowledge Update Prompt
KNOWLEDGE_UPDATE_PROMPT = """
Freshservice and Confluence Knowledge Update Agent

Persona: Freshservice and Confluence Knowledge Specialist

Goal: To update Freshservice and Confluence Knowledge Bases upon ticket confirmation or timeout based on resolution pathway.

Knowledge:
• Freshservice Metadata Tags - Lookup tool
• Guidelines around Freshservice Metadata Tag usage
• List of Platform Admins

Rules: 

Instructions:
1. Lookup Freshservice KB using Lookup Freshservice Knowledge Base Tool to see if relevant documents are currently valid or require an update. If the Freshservice KB requires an update based on the current ticket resolution, draft the recommended update the KB. Return the draft to the manager, making sure to tag (using @) the admin for the appropriate platform.
2. Lookup the Dependency Map using the Lookup Dependency Map Tool to see if the ticket history aligns with the dependency map, or if the dependency map may need an update. If the dependency map appears to require an update, draft the recommended update and use the Create Confluence Draft Tool to add the draft for an admin to later review.
3. Look up existing tags using Lookup Freshservice Tags Tool. 
4. Draft a list of tags to apply to the ticket. Always indicate that is was an agentic workflow using the "AI" tag. Always indicate whether the workflow was resolved or timed out using the "resolved" or "timeout" tags respectively. If a Freshservice KB update has been recommended, add the tag "KB Update Recommendation". If a Dependency Map update has been recommended, add the tag "Dependency Map Update Recommendation". For other tags, prioritize using existing tags as much as possible and follow the metadata tag guidelines provided. If no meaningful tag exists, then proceed with a new tag string. Update the ticket with the drafted tags using the Updated Freshservice Ticket Tags Tool. 
 
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
    ticket_id: Annotated[
        FreshserviceTicketId,
        Field(
            description="Ticket supplied by the manager.",
        ),
    ]
    
    status: Annotated[
        Literal[
            'recommendation_pending',
            'knowledge_updated',
            'failed',
        ],
        Field(
            description="Whether the manager must save a recommendation note or knowledge processing is complete.",
        ),
    ]
    
    trigger_type: Annotated[
        Literal[
            'resolution_confirmed',
            'confirmation_timeout',
        ],
        Field(
            description="Explicit human-outcome trigger supplied by the manager.",
        ),
    ]
    
    recommendation_article_id: Annotated[
        str | None,
        Field(
            description="Existing Freshservice article needing a private recommendation note, if any.",
        ),
    ]
    
    recommendation_body: Annotated[
        str | None,
        Field(
            description="Proposed Freshservice article update including the article ID, supporting references and appropriate platform administrator @mention.",
        ),
    ]
    
    drafted_comment: Annotated[
        str | None,
        Field(
            description="Additional review findings for the manager's private ticket note.",
        ),
    ]
    
    evidence_references: Annotated[
        list[str],
        Field(
            description="Actual article, mapping, ticket and saved draft references supporting recommendations.",
        ),
    ]
    
    confluence_draft_ids: Annotated[
        list[str],
        Field(
            description="Administrator-review draft IDs confirmed saved by the draft tool.",
        ),
    ]
    
    proposed_tags: Annotated[
        list[str],
        Field(
            description="Complete proposed tag additions, including any pending recommendation tag.",
        ),
    ]
    
    applied_tags: Annotated[
        list[str],
        Field(
            description="Tags confirmed persisted; empty when the manager must first save a note.",
        ),
    ]
    
    errors: Annotated[
        list[str],
        Field(
            description="Verified tool errors or missing persisted human-outcome evidence.",
        ),
    ]
    
    sources_used: Annotated[
        list[
            Literal[
                'freshservice_knowledge_base',
                'confluence',
                'ticket_history',
                'applications_support_keywords',
            ]
        ],
        Field(
            description="Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed.",
        ),
    ]
    
    confidence: Annotated[
        float,
        Field(
            ge=0,
            le=1,
            description="Confidence in the returned decision, including no change or insufficient evidence, not unknown incident facts; below 0.90 stops for human review.",
        ),
    ]
    
    confidence_reason: Annotated[
        str,
        Field(
            description="Evidence and uncertainty supporting the confidence score.",
        ),
    ]


def make_knowledge_update_agent() -> Agent:
    """Create the Freshservice and Confluence Knowledge Update specialist."""
    return Agent(
        name="Freshservice and Confluence Knowledge Update Agent",
        instructions=KNOWLEDGE_UPDATE_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
            lookup_dependency_map_tool, 
            lookup_freshservice_knowledge_base_tool,
            create_confluence_draft_tool,
            lookup_freshservice_tags_tool,
            update_freshservice_ticket_tags_tool
        ],
        input_guardrails=[], # TODO: Add specialist input guardrails
        output_guardrails=[], # TODO: Add specialist output guardrails
        output_type=KnowledgeUpdateOutput,
    )


knowledge_update_agent: Agent = make_knowledge_update_agent()
