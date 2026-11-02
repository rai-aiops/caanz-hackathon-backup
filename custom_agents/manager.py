"""CAANZ Manager agent from PRD section 2.3."""

from typing import Annotated, Literal

from agents import Agent, ModelSettings, RunHooks
from pydantic import BaseModel, Field

# TODO: Import manager guardrails
# from guardrails import () 

# TODO: Import manager tools
from tools import (
    FreshserviceMessage,
    FreshserviceNote,
    FreshserviceTicketId,
    lookup_ticket_data_tool,
    add_private_note_tool, 
    send_reply_tool
)


from .applications_assignment import make_applications_assignment_agent
from .platform_detection import make_platform_detection_agent
from .knowledge_update import make_knowledge_update_agent

MAX_TURNS_SPECIALIST = 50

# TODO: Implement Applications Assignment Specialist Description
APPLICATIONS_ASSIGNMENT_TOOL_DESCRIPTION = """
A specialist attempts to classify the ticket and assign it to either application support infrusture or education. 
""".strip()

PLATFORM_DETECTION_TOOL_DESCRIPTION = """
A specialist that attempts to assign tickets to the right platform by inspecting the confluence knowledge base and boomi logs.
""".strip()

KNOWLEDGE_UPDATE_TOOL_DESCRIPTION = """
A specialist that makes recommendations to the knowledge base after a ticekt is closed.
""".strip()

MANAGER_AGENT_PROMPT = """
    Manager Agent

    Persona: IT Supervisor

    Goal: To support detection of Applications Support IT tickets and guide them towards the correct resolution specialist by calling the correct specialist agents in the correct sequence and managing data handoff between them.

    Knowledge:
    • Trigger 1 - New ticket sent over from Freshservice admin
    • Trigger 2 - Freshservice agent has confirmed ticket resolution
    • Trigger 3 - Freshservice ticket has timed out without agent confirmation of resolution
    • Trigger 4 - Email update from the requestor providing additional data.

    Email Update: 
    If payload is an email response from the requestor providing additional data:
    • Append the additional data to the ticket as a comment using the Add Private Note Tool.
    • Proceed with standard procedure.

    Rules: 

    Instructions:
    As the manager, you will received different payloads representing different types of triggers. Identify which trigger you have received, and following the corresponding procedure below. 

    Trigger 1 Procedure: (New Ticket)
    1. Get Ticket Data using Lookup Ticket Data Tool which should include the initial email and attachments. Be sure to pass along the full ticket to all specialists.
    2. Call the Freshservice Applications Assignment Agent in order to try and correctly classify the ticket and assign it to the right team. 
    3. The specialist may return drafted comments to add to the ticket. Update the ticket with the drafted comments using the Add Private Note Tool. 
    4. The specialist will return a flag indicating whether the ticket was assigned to the Applications Support team, to a specific platform within the Applications Support team, or left for manual human review. If the ticket has been left for manual human review or assigned to a platform, end the workflow. 
    5. Otherwise, call the Applications Platform Detection Agent which should attempt to localize the correct platform and assign the ticket to the correct platform team. 
    6. The specialist may return comments to add to the ticket. Update the ticket with the drafted comments using the Add Private Note Tool.
    7. The specialist may return a draft of a response to the requestor asking for supplemental missing data. Please send the drafted response using the Send Reply Tool. 
    8. The specialist should return a status indicating assignment to the correct platform or the need for manual human review. Summarize, return the status, and end procedure. 

    Trigger 2 (Resolution Confirmation) and Trigger 3 (Timeout):
    1. Get Ticket Data using Lookup Ticket Data Tool which should include the initial email and attachments. Be sure to pass along the full ticket to all specialists.
    2. Call the Freshservice and Confluence Knowledge Update Tool. Make sure you pass along the trigger type so the specialist knows if it's dealign with a timeout or a successful resolution confirmation.
    3. The specialist may return a drafted knowledge base update for the Freshservice KB. Use the Add Private Note Tool to add the draft as a comment to the ticket. 

    Trigger 4: (Email Update from Requestor):
    1. Get Ticket Data using Lookup Ticket Data Tool which should include the initial email and attachments. Be sure to pass along the full ticket to all specialists.
    2. The email response from the requestor should contain additional data that was originally missing. Append the additional to the ticket as a comment using the Add Private Note Tool.
    3. Call the Freshservice and Confluence Knowledge Update Tool. Make sure you pass along the trigger type so the specialist knows if it's dealign with a timeout or a successful resolution confirmation.
    4. The specialist may return a drafted knowledge base update for the Freshservice KB. Use the Add Private Note Tool to add the draft as a comment to the ticket. 
    
 
""".strip()


class ManagerOutput(BaseModel):
    """Structured output of the manager agent.
    Fields:
        status: Outcome of this trigger procedure, separate from persisted ticket status. (Options: "platform_assigned", "waiting_for_information", "manual_review", "knowledge_updated", "failed")
        trigger_type: Structured CAANZ trigger handled, or null when invalid. (Options: "new_ticket", "requester_update", "resolution_confirmed", "confirmation_timeout", or None)
        ticket_id: Associated ticket, or null when no valid ID was supplied. (Type: FreshserviceTicketId | None)
        classification: Current classification read from the persisted ticket. (Options: "Application Support", "Infrastructure", "Education", or None)
        platform: Current platform read from the persisted ticket. (Options: "Sitecore", "Salesforce", "Boomi", "NetSuite", or None)
        ticket_status: Actual persisted ticket status; not an inferred waiting/manual-review transition. (Type: str | None)
        private_notes: Private notes confirmed saved during this trigger procedure. (Type: list[FreshserviceNote])
        sent_reply: Requester reply confirmed saved by Send Reply Tool, if any. (Type: FreshserviceMessage | None)
        confluence_draft_ids: Administrator-review draft IDs confirmed saved by the specialist. (Type: list[str])
        summary: Concise summary of verified actions, routing and current outcome. (Type: str)
        next_action: Required requester, human or application action; null when this procedure is complete. (Type: str | None)
        errors: Verified blocking errors or missing required application input/state. (Type: list[str])
        sources_used: Knowledge sources that meaningfully contributed to this decision, as source literals; empty when none contributed. (Type: list of "freshservice_knowledge_base", "confluence", "ticket_history", "applications_support_keywords")
        confidence: Confidence in the orchestration outcome, from 0 to 1 inclusive; outputs below 0.90 stop for human review. (Type: float)
        confidence_reason: Evidence and uncertainty supporting the confidence score. (Type: str)
    """
    status: Annotated[
    Literal[
        'platform_assigned',
        'waiting_for_information',
        'manual_review',
        'knowledge_updated',
        'failed',
    ],
    Field(
        description="Outcome of this trigger procedure, separate from persisted ticket status.",
    ),
]

trigger_type: Annotated[
    Literal[
        'new_ticket',
        'requester_update',
        'resolution_confirmed',
        'confirmation_timeout',
    ] | None,
    Field(
        description="Structured CAANZ trigger handled, or null when invalid.",
    ),
]

ticket_id: Annotated[
    FreshserviceTicketId | None,
    Field(
        description="Associated ticket, or null when no valid ID was supplied.",
    ),
]

classification: Annotated[
    Literal[
        'Application Support',
        'Infrastructure',
        'Education',
    ] | None,
    Field(
        description="Current classification read from the persisted ticket.",
    ),
]

platform: Annotated[
    Literal[
        'Sitecore',
        'Salesforce',
        'Boomi',
        'NetSuite',
    ] | None,
    Field(
        description="Current platform read from the persisted ticket.",
    ),
]

ticket_status: Annotated[
    str | None,
    Field(
        description="Actual persisted ticket status; not an inferred waiting/manual-review transition.",
    ),
]

private_notes: Annotated[
    list[FreshserviceNote],
    Field(
        description="Private notes confirmed saved during this trigger procedure.",
    ),
]

sent_reply: Annotated[
    FreshserviceMessage | None,
    Field(
        description="Requester reply confirmed saved by Send Reply Tool, if any.",
    ),
]

confluence_draft_ids: Annotated[
    list[str],
    Field(
        description="Administrator-review draft IDs confirmed saved by the specialist.",
    ),
]

summary: Annotated[
    str,
    Field(
        description="Concise summary of verified actions, routing and current outcome.",
    ),
]

next_action: Annotated[
    str | None,
    Field(
        description="Required requester, human or application action; null when this procedure is complete.",
    ),
]

errors: Annotated[
    list[str],
    Field(
        description="Verified blocking errors or missing required application input/state.",
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
        description="Confidence in the orchestration outcome, from 0 to 1 inclusive; outputs below 0.90 stop for human review.",
    ),
]

confidence_reason: Annotated[
    str,
    Field(
        description="Evidence and uncertainty supporting the confidence score.",
    ),
]

    


def make_manager_agent(hooks: RunHooks | None = None) -> Agent:
    """Create the CAANZ manager with the PRD's three specialist tools."""
    assignment = make_applications_assignment_agent()
    detection = make_platform_detection_agent()
    knowledge = make_knowledge_update_agent()

    return Agent(
        name="CAANZ Manager Agent",
        instructions=MANAGER_AGENT_PROMPT,
        model="gpt-6.1-terra",
        model_settings=ModelSettings(tool_choice="auto"),
        tools=[
            assignment.as_tool(
                tool_name="freshservice_applications_assignment_agent",
                tool_description=APPLICATIONS_ASSIGNMENT_TOOL_DESCRIPTION,
                max_turns=MAX_TURNS_SPECIALIST,
                hooks=hooks,
                failure_error_function=None,
            ),
            detection.as_tool(
                tool_name="applications_platform_detection_agent",
                tool_description=PLATFORM_DETECTION_TOOL_DESCRIPTION,
                max_turns=MAX_TURNS_SPECIALIST,
                hooks=hooks,
                failure_error_function=None,
            ), 
            knowledge.as_tool(
                tool_name="freshservice_confluence_knowledge_update_agent",
                tool_description=KNOWLEDGE_UPDATE_TOOL_DESCRIPTION,
                max_turns=MAX_TURNS_SPECIALIST,
                hooks=hooks,
                failure_error_function=None,
            ),
            lookup_ticket_data_tool,
            add_private_note_tool,
            send_reply_tool
        ],
        input_guardrails=[], # TODO: Add manager input guardrails
        output_guardrails=[], # TODO: Add manager output guardrails
        output_type=ManagerOutput,
    )


manager_agent: Agent = make_manager_agent()
