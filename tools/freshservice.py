"""Freshservice ticket, catalog, search and write tools over local CAANZ fixtures."""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from agents import function_tool
from pydantic import AwareDatetime, BaseModel, Field

from guardrails import (
    tool_confidence_guardrail,
    tool_prompt_injection_and_malware_guardrail,
)

from .helpers import (
    RecordNotFound,
    fixture_lock,
    read_store,
    search_records,
    write_store,
)

TICKETS_FILE = "freshservice_tickets.json"
CATALOG_FILE = "freshservice_catalogues.json"
DEFAULT_FRESHSERVICE_ACTOR = {
    "type": "automated",
    "id": "AGENT-CAANZ",
    "name": "CAANZ workflow",
}
FreshserviceTicketId = Annotated[str, Field(pattern=r"^FS-\d+$")]


class FreshserviceActor(BaseModel):
    """Requester, note author or resolution author stored on a Freshservice ticket."""

    type: Literal["human", "automated", "system"]
    id: str
    name: str | None = None
    email: str | None = None


class FreshserviceMessage(BaseModel):
    ticket_id: FreshserviceTicketId
    direction: Literal["inbound", "outbound"]
    timestamp: AwareDatetime
    from_address: str
    to: list[str]
    cc: list[str]
    subject: str
    body: str


class FreshserviceIncident(BaseModel):
    timestamp: AwareDatetime | None
    reported_timezone: str | None
    customer_id: str | None
    member_id: str | None
    customer_email: str | None
    customer_name: str | None


class FreshserviceNote(BaseModel):
    timestamp: AwareDatetime
    author: FreshserviceActor
    body: str


class FreshserviceResolution(BaseModel):
    summary: str
    resolved_by: FreshserviceActor
    resolved_at: AwareDatetime
    confirmed_at: AwareDatetime | None
    closed_at: AwareDatetime | None
    confirmation_outcome: Literal["resolved", "timeout"]


class FreshserviceTicket(BaseModel):
    id: FreshserviceTicketId
    subject: str
    description: str
    created_at: AwareDatetime
    requester: FreshserviceActor
    status: str
    priority: str
    classification: str | None
    category: str
    subcategory: str
    platform: str | None
    assigned_group_id: str
    incident: FreshserviceIncident
    tags: list[str]
    conversation: list[FreshserviceMessage]
    private_notes: list[FreshserviceNote]
    resolution: FreshserviceResolution | None


class FreshserviceCategoriesResult(BaseModel):
    classifications: list[str]
    categories: list[dict[str, Any]]


class FreshserviceSearchMatch(BaseModel):
    record: dict[str, Any]
    matched_terms: list[str]
    matched_fields: dict[str, list[str]]
    score: int


class FreshserviceSearchResult(BaseModel):
    """Ranked keyword, historical-ticket or support-article search matches."""

    matches: list[FreshserviceSearchMatch]


class FreshserviceTemplateResult(BaseModel):
    subject: str
    body: str
    placeholders: list[str]


class FreshserviceTagsResult(BaseModel):
    tags: list[dict[str, Any]]
    tagging_guidelines: str


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_ticket_data_tool(
    ticket_id: FreshserviceTicketId,
) -> FreshserviceTicket:
    """Read the current ticket, including its conversation, notes and resolution.

    Args:
        ticket_id: Existing Freshservice ticket ID.

    Returns:
        The current ticket, including its conversation, notes and resolution.
    """
    entry = read_store(TICKETS_FILE)["tickets"].get(ticket_id)
    if entry is None:
        raise RecordNotFound(f"Unknown ticket: {ticket_id}")
    return FreshserviceTicket.model_validate(entry["ticket"])


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_freshservice_categories_tool() -> FreshserviceCategoriesResult:
    """Read classification, category and subcategory options from the local catalog.

    Args:
        None.

    Returns:
        Available classifications, categories and their subcategories.
    """
    catalog = read_store(CATALOG_FILE)
    return FreshserviceCategoriesResult(
        classifications=catalog["classifications"],
        categories=catalog["categories"],
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_applications_support_keywords_tool(
    query: str = "", limit: int = 10
) -> FreshserviceSearchResult:
    """Find contextual support terms without deciding classification or ownership.

    Args:
        query: Words to match; empty returns the keyword reference.
        limit: Maximum number of matches, from 1 to 50.

    Returns:
        Ranked keyword records with matched terms and fields.
    """
    store = read_store("applications_support_keywords.json")
    return FreshserviceSearchResult(
        matches=search_records(
            store["entries"],
            query,
            ("term", "expansion", "aliases", "context"),
            limit,
        ),
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_freshservice_historical_tickets_tool(
    query: Annotated[str, Field(min_length=1)],
    current_ticket_id: FreshserviceTicketId,
    limit: int = 10,
) -> FreshserviceSearchResult:
    """Search closed tickets for classification and platform precedents.

    Args:
        query: Relevant problem terms, not a classification confidence score.
        current_ticket_id: Ticket to exclude from the historical results.
        limit: Maximum number of matches, from 1 to 50.

    Returns:
        Ticket IDs, classification, platform, findings and resolution with match evidence.
    """
    catalog = read_store(CATALOG_FILE)
    closed = {
        status["name"]
        for status in catalog["statuses"]
        if status["state"] == "closed"
    }
    records = [
        {
            key: entry["ticket"][key]
            for key in (
                "id",
                "subject",
                "description",
                "classification",
                "category",
                "subcategory",
                "platform",
                "assigned_group_id",
                "resolution",
                "private_notes",
            )
        }
        for ticket_id, entry in read_store(TICKETS_FILE)["tickets"].items()
        if ticket_id != current_ticket_id and entry["ticket"]["status"] in closed
    ]
    return FreshserviceSearchResult(
        matches=search_records(
            records,
            query,
            ("subject", "description", "private_notes", "resolution"),
            limit,
        ),
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_freshservice_knowledge_base_tool(
    query: str, limit: int = 10
) -> FreshserviceSearchResult:
    """Search published Freshservice support articles separately from ticket history.

    Args:
        query: Support terms to search; empty returns published articles.
        limit: Maximum number of matches, from 1 to 50.

    Returns:
        Ranked article records with content, ownership and match evidence.
    """
    articles = read_store("freshservice_kb.json")["articles"]
    return FreshserviceSearchResult(
        matches=search_records(
            [article for article in articles if article["status"] == "published"],
            query,
            ("id", "title", "body", "tags", "platforms", "process_ids"),
            limit,
        ),
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def get_acknowledgement_template_tool() -> FreshserviceTemplateResult:
    """Retrieve the acknowledgement template without sending a message.

    Args:
        None.

    Returns:
        The acknowledgement subject, body and required placeholders.
    """
    return FreshserviceTemplateResult.model_validate(
        read_store(CATALOG_FILE)["acknowledgement_template"]
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def lookup_freshservice_tags_tool() -> FreshserviceTagsResult:
    """Retrieve existing ticket tags and tagging guidelines.

    Args:
        None.

    Returns:
        Existing tags and tagging guidelines.
    """
    catalog = read_store(CATALOG_FILE)
    return FreshserviceTagsResult(
        tags=catalog["tags"],
        tagging_guidelines=catalog["tagging_guidelines"],
    )


# TODO: Turn into a function tool and attach relevant tool guardrails
def update_ticket_classification_tool(
    ticket_id: FreshserviceTicketId,
    classification: str,
    agent_confidence: Annotated[float, Field(ge=0, le=1)],
) -> FreshserviceTicket:
    """Update only the ticket's classification.

    Args:
        ticket_id: Ticket to classify.
        classification: Catalog classification supported by the investigation.
        agent_confidence: Confidence in this classification; at least 0.90 is required.

    Returns:
        The saved ticket with the requested classification.
    """
    if classification not in read_store(CATALOG_FILE)["classifications"]:
        raise ValueError(f"{classification} is not a valid classification.")

    with fixture_lock():
        store = read_store(TICKETS_FILE)

        if ticket_id not in store["tickets"]:
            raise RecordNotFound(f"Unknown ticket: {ticket_id}")

        ticket = store["tickets"][ticket_id]["ticket"]
        if ticket["status"] in {"Resolved", "Closed"}:
            raise ValueError("Classification cannot change a resolved or closed ticket.")

        ticket["classification"] = classification

        result = FreshserviceTicket.model_validate(ticket)
        write_store(TICKETS_FILE, store)
        return result


# TODO: Turn into a function tool and attach relevant tool guardrails
def update_ticket_platform_tool(
    ticket_id: FreshserviceTicketId,
    platform: str,
    agent_confidence: Annotated[float, Field(ge=0, le=1)],
) -> FreshserviceTicket:
    """Route a ticket to the catalog-backed platform group.

    Args:
        ticket_id: Existing ticket to route.
        platform: Exact catalog platform name.
        agent_confidence: Confidence in this platform assignment; at least 0.90 is required.

    Returns:
        The ticket with its platform, assigned group and Assigned status.
    """
    catalog = read_store(CATALOG_FILE)
    platform_info = next(
        (item for item in catalog["platforms"] if item["name"] == platform), None
    )
    if platform_info is None:
        raise ValueError(f"Unknown platform: {platform}")

    with fixture_lock():
        store = read_store(TICKETS_FILE)
        if ticket_id not in store["tickets"]:
            raise RecordNotFound(f"Unknown ticket: {ticket_id}")

        ticket = store["tickets"][ticket_id]["ticket"]
        if ticket["status"] in {"Resolved", "Closed"}:
            raise ValueError(
                "Platform assignment cannot reopen a resolved or closed ticket."
            )
        updates = {
            "platform": platform,
            "assigned_group_id": platform_info["group_id"],
            "status": "Assigned",
        }
        ticket.update(updates)

        result = FreshserviceTicket.model_validate(ticket)
        write_store(TICKETS_FILE, store)
        return result


# TODO: Turn into a function tool and attach relevant tool guardrails
def add_private_note_tool(
    ticket_id: FreshserviceTicketId,
    body: Annotated[str, Field(min_length=1)],
) -> FreshserviceNote:
    """Append a private finding or Freshservice KB recommendation.

    Args:
        ticket_id: Ticket receiving the private note.
        body: Narrative findings or proposed article change, including the admin mention.

    Returns:
        The saved note with the automated CAANZ workflow as its author.
    """
    if not body.strip():
        raise ValueError("Note body cannot be blank.")
    with fixture_lock():
        store = read_store(TICKETS_FILE)
        if ticket_id not in store["tickets"]:
            raise RecordNotFound(f"Unknown ticket: {ticket_id}")
        ticket = store["tickets"][ticket_id]["ticket"]
        note = FreshserviceNote(
            timestamp=datetime.now(UTC).isoformat(),
            author=DEFAULT_FRESHSERVICE_ACTOR,
            body=body.strip(),
        )
        ticket["private_notes"].append(note.model_dump(mode="json"))
        FreshserviceTicket.model_validate(ticket)
        write_store(TICKETS_FILE, store)
    return note


# TODO: Turn into a function tool and attach relevant tool guardrails
def send_reply_tool(
    ticket_id: FreshserviceTicketId,
    subject: Annotated[str, Field(min_length=1)],
    body: Annotated[str, Field(min_length=1)],
) -> FreshserviceMessage:
    """Simulate a successful requester reply inside the Freshservice conversation.

    Args:
        ticket_id: Ticket whose requester receives the message.
        subject: Reply subject.
        body: Requester-facing message text.

    Returns:
        The locally persisted outbound message, without real email delivery.
    """
    if not subject.strip() or not body.strip():
        raise ValueError("Reply subject and body cannot be blank.")
    with fixture_lock():
        store = read_store(TICKETS_FILE)
        if ticket_id not in store["tickets"]:
            raise RecordNotFound(f"Unknown ticket: {ticket_id}")
        ticket = store["tickets"][ticket_id]["ticket"]
        message = FreshserviceMessage(
            ticket_id=ticket_id,
            direction="outbound",
            timestamp=datetime.now(UTC).isoformat(),
            from_address="servicedesk@example.com",
            to=[ticket["requester"]["email"]],
            cc=[],
            subject=subject.strip(),
            body=body.strip(),
        )
        ticket["conversation"].append(message.model_dump(mode="json"))
        FreshserviceTicket.model_validate(ticket)
        write_store(TICKETS_FILE, store)
    return message


# TODO: Turn into a function tool and attach relevant tool guardrails
def update_freshservice_ticket_tags_tool(
    ticket_id: FreshserviceTicketId,
    tags: list[str],
) -> FreshserviceTicket:
    """Merge supplied tags into the ticket, preserving existing tags.

    Args:
        ticket_id: Ticket receiving the tags.
        tags: Tags selected by the caller according to the tagging guidelines.

    Returns:
        The updated ticket with merged, deduplicated tags.
    """
    with fixture_lock():
        store = read_store(TICKETS_FILE)
        ticket = store["tickets"][ticket_id]["ticket"]
        ticket["tags"] = list(set(ticket["tags"]) | set(tags))
        result = FreshserviceTicket.model_validate(ticket)
        write_store(TICKETS_FILE, store)
        return result
