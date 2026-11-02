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
    lookup_ticket_data_tool
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
You are a temporary manager agent. Your job is to respond to user prompts. Always lookup the ticket using lookup_ticket_data_tool, then call the application agent and be sure to pass it the ticket data. If its an appliactions ticket, send it to detection specialist.
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
    pass  # TODO: Implement fields for ManagerOutput


def make_manager_agent(hooks: RunHooks | None = None) -> Agent:
    """Create the CAANZ manager with the PRD's three specialist tools."""
    assignment = make_applications_assignment_agent()
    detection = make_platform_detection_agent()
    knowledge = make_knowledge_update_agent

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
            lookup_ticket_data_tool
        ],
        input_guardrails=[], # TODO: Add manager input guardrails
        output_guardrails=[], # TODO: Add manager output guardrails
        # output_type=ManagerOutput,
    )


manager_agent: Agent = make_manager_agent()
