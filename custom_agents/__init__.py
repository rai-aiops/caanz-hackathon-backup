"""CAANZ agent factories, instances and structured outputs."""

from .applications_assignment import (
    ApplicationsAssignmentOutput,
    applications_assignment_agent,
    make_applications_assignment_agent,
)
from .knowledge_update import (
    KnowledgeUpdateOutput,
    knowledge_update_agent,
    make_knowledge_update_agent,
)
from .manager import ManagerOutput, make_manager_agent, manager_agent
from .platform_detection import (
    PlatformDetectionOutput,
    RequesterReplyDraft,
    make_platform_detection_agent,
    platform_detection_agent,
)

__all__ = [
    "ApplicationsAssignmentOutput",
    "KnowledgeUpdateOutput",
    "ManagerOutput",
    "PlatformDetectionOutput",
    "RequesterReplyDraft",
    "applications_assignment_agent",
    "knowledge_update_agent",
    "make_applications_assignment_agent",
    "make_knowledge_update_agent",
    "make_manager_agent",
    "make_platform_detection_agent",
    "manager_agent",
    "platform_detection_agent",
]
