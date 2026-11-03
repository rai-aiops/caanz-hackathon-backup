"""Applications Platform Detection agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings
from pydantic import BaseModel, Field

from guardrails import (analysis_confidence_guardrail)

from tools import (
    FreshserviceTicketId,
    lookup_dependency_map_tool,
    lookup_access_layer_tool,
    lookup_confluence_knowledge_base_tool,
    inspect_boomi_log_tool,
    update_ticket_platform_tool
)


PLATFORM_DETECTION_PROMPT = """
Applications Platform Detection Agent

Persona: Application Platform Detection Specialist

Goal: To inspect Boomi logs, identify the root cause of an issue, and assign the ticket to the correct platform team. 

Knowledge:
Dependency Map
Confluence Knowledge Base - Boomi Processes
Confluence Knowledge Base - Access Layer
Boomi Logs (Boomi Platform Lookup)
Platform Teams: Sitecore, Salesforce, Boomi, Netsuite

Required Data: 
• Any of: Customer ID, Member ID, Customer Name, Customer Email
• Timestamp of incident

Rules: 
• Include a source in sources_used only when evidence actually retrieved or explicitly supplied from that source meaningfully contributed to this decision. The current ticket, its conversation and investigation notes are not ticket_history; use ticket_history only for retrieved historical-ticket evidence. Use freshservice_knowledge_base only for actual Freshservice support-article evidence, not Confluence pages. Do not infer source usage from available output labels or from sources another specialist may have consulted. Boomi logs have no corresponding source literal; cite them in evidence_references rather than assigning an unrelated source label.

Instructions:

Standard Procedure:
1. Confirm the ticket has all of the required data. If not, draft a follow up email to the requestor asking for the missing data pieces and return the draft to the manager. Stop procedure. 
2. Lookup Dependency Map using lookup Lookup Dependency Map Tool.
3. Lookup the Access Layer document using the Lookup Access Layer Tool. Based on the email context, identify which layers may be affected by the issue.
4. Keyword lookup from email body and access layer to confluence API using Confluence Knowledge Base Lookup Tool to retrieve relevant process documentation and identify suspect Boomi processes to inspect.
5. (Note: may need to translate other identifiers to customer ID in future versions)
6. Lookup and parse Boomi logs using Inspect Boomi Log Tool based on identified processes, customer ID (or alternatives), and timestamp to try and find any error messages.
7. If an error message is found, identify the relevant platform in the error message. Assign the ticket to the appropriate platform team using the Update Ticket Platform Tool. Additionally, return documentation from the Boomi process as well as the Boomi log error as a drafted ticket comment to the manager. Otherwise, continue to investigate additional Boomi processes. 
8. If an error message cannot be found, return a drafted comment to the manager summarizing the investigation steps already taken. End workflow with status manual review.
""".strip()


class RequesterReplyDraft(BaseModel):
    """Structured requester reply draft for the manager to send.
    Fields:
        subject: Subject for the manager's Freshservice requester reply. (Type: str)
        body: One requester-facing request for the missing incident facts. (Type: str)
    """
    subject: Annotated[str, Field(
            description="Subject for the manager's Freshservice requester reply.",
        )]
    body: Annotated[str, Field(
        description="One requester-facing request for the missing incident facts.",
    )]


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
    ticket_id: Annotated[FreshserviceTicketId, Field(
        description="Ticket supplied by the manager.",
    )]
    status: Annotated[ Literal['application_support_assigned', 'platform_assigned', 'manual_review', 'failed'], Field(
        description="Verified classification, platform routing or required human review.",
    )]
    platform: Annotated[
    Literal['Sitecore', 'Salesforce', 'Boomi', 'NetSuite'] | None,
    Field(
        description="Platform actually assigned, or null when assignment was not possible.",
    )]
    missing_information: Annotated[
        list[str],
        Field(
            description="Required incident facts absent from the current ticket.",
        ),
    ]
    reply_draft: Annotated[
        RequesterReplyDraft | None,
        Field(
            description="Missing-information reply for the manager to send; never sent by this agent.",
        ),
    ]

    drafted_comment: Annotated[
        str | None,
        Field(
            description="Findings and investigation steps for the manager to save as a private note, including retrieved Boomi log lines verbatim in fenced text code blocks with process IDs and log path/one-based line ranges when available.",
        ),
    ]

    process_ids: Annotated[
        list[str],
        Field(
            description="Candidate process IDs investigated using retrieved documentation.",
        ),
    ]

    execution_ids: Annotated[
        list[str],
        Field(
            description="All execution IDs actually retrieved and inspected; empty if none matched.",
        ),
    ]

    evidence_references: Annotated[
        list[str],
        Field(
            description="Retrieved document/process/execution IDs and log path/one-based line references supporting findings.",
        ),
    ]

    errors: Annotated[
        list[str],
        Field(
            description="Verified blocking errors; inconclusive evidence belongs in the drafted comment.",
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
            description="Confidence in the returned decision, including manual review, not an unknown platform; below 0.90 stops for human review.",
        ),
    ]

    confidence_reason: Annotated[
        str,
        Field(
            description="Evidence and uncertainty supporting the confidence score.",
        ),
    ]


def make_platform_detection_agent() -> Agent:
    """Create the Applications Platform Detection specialist."""
    return Agent(
        name="Applications Platform Detection Agent",
        instructions=PLATFORM_DETECTION_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
                lookup_dependency_map_tool,
                lookup_access_layer_tool,
                lookup_confluence_knowledge_base_tool,
                inspect_boomi_log_tool,
                update_ticket_platform_tool
        ],
        input_guardrails=[],
        output_guardrails=[analysis_confidence_guardrail],
        output_type=PlatformDetectionOutput,
    )


platform_detection_agent: Agent = make_platform_detection_agent()
