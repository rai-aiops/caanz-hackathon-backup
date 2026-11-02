"""Read mock Confluence pages and create administrator-review drafts."""

from datetime import UTC, datetime
from typing import Literal

from agents import function_tool
from pydantic import AwareDatetime, BaseModel

from guardrails import tool_prompt_injection_and_malware_guardrail

from .boomi import BOOMI_PROCESSES
from .helpers import fixture_lock, read_store, search_records, write_store

CONFLUENCE_FILE = "confluence_kb.json"
DEFAULT_CONFLUENCE_AUTHOR = "CAANZ workflow"


class ConfluencePage(BaseModel):
    id: str
    title: str
    status: Literal["published", "draft"]
    version: int
    created_at: AwareDatetime | None = None
    updated_at: AwareDatetime | None = None
    author: str | None = None
    body: str


class ConfluenceSearchMatch(BaseModel):
    record: ConfluencePage
    matched_terms: list[str]
    matched_fields: dict[str, list[str]]
    score: int


class ConfluenceSearchResult(BaseModel):
    matches: list[ConfluenceSearchMatch]


@function_tool
def lookup_dependency_map_tool() -> ConfluencePage:
    """Read the dependency-map page, including its documented uncertainty and gaps.

    Args:
        None.

    Returns:
        Page metadata and complete document text for the agent to interpret.
    """
    return ConfluencePage.model_validate(read_store("confluence_dependency_map.json"))


@function_tool
def lookup_access_layer_tool() -> ConfluencePage:
    """Read the separate system architecture and Access Layer page.

    Args:
        None.

    Returns:
        Page metadata and complete document text for the agent to interpret.
    """
    return ConfluencePage.model_validate(read_store("confluence_access_layer.json"))


@function_tool
def lookup_confluence_knowledge_base_tool(
    query: str, limit: int = 10
) -> ConfluenceSearchResult:
    """Search the titles and text of published process-documentation pages.

    Args:
        query: Functional terms or an exact process ID/name; empty lists published pages.
        limit: Maximum number of matches, from 1 to 50.

    Returns:
        Ranked pages with complete document text and match evidence.
    """
    pages = [
        page for page in read_store(CONFLUENCE_FILE)["pages"]
        if page["status"] == "published"
    ]
    process_id = next(
        (
            identifier for identifier, name in BOOMI_PROCESSES.items()
            if query.strip().casefold() in {identifier.casefold(), name.casefold()}
        ),
        None,
    )
    if process_id is not None:
        pages = [
            page for page in pages
            if f"process id: {process_id}".casefold()
            in {line.strip().casefold() for line in page["body"].splitlines()}
        ]
    return ConfluenceSearchResult(
        matches=search_records(
            pages,
            query,
            ("id", "title", "body"),
            limit,
        ),
    )


@function_tool
def create_confluence_draft_tool(
    source_ticket_id: str,
    target_record_id: str,
    title: str,
    body: str,
) -> ConfluencePage:
    """Save an administrator-review draft using the shared Confluence page format.

    Args:
        source_ticket_id: Freshservice ticket supporting the recommendation.
        target_record_id: Page being recommended for change; cite any section in the body.
        title: Administrator-facing draft title.
        body: Proposed correction with supporting evidence; no published content is changed.

    Returns:
        A new draft page with source and target references in its body and a fixed author.
    """
    if not title.strip() or not body.strip():
        raise ValueError("Draft title and body cannot be blank.")
    with fixture_lock():
        store = read_store(CONFLUENCE_FILE)
        stamp = datetime.now(UTC).isoformat()
        draft = ConfluencePage(
            id=f"CONF-DRAFT-{store['next_draft_number']:04d}",
            title=title.strip(),
            status="draft",
            version=1,
            created_at=stamp,
            updated_at=stamp,
            author=DEFAULT_CONFLUENCE_AUTHOR,
            body=(
                f"{body.strip()}\n\n## Review context\n\n"
                f"Source ticket: {source_ticket_id}\n\n"
                f"Proposed update to: {target_record_id}"
            ),
        )
        store["pages"].append(draft.model_dump(mode="json"))
        store["next_draft_number"] += 1
        write_store(CONFLUENCE_FILE, store)
    return draft
