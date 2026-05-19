"""
orca-client: Official Python client for Elkhedr Orca multi-agent orchestration API.
"""

from .client import OrcaClient, OrcaError
from .types import (
    ChatRequest,
    ChatResponse,
    Agent,
    Session,
    Message,
    Skill,
    Quota,
    Webhook,
    Integration,
    HealthStatus,
)

__version__ = "1.0.0"
__all__ = [
    "OrcaClient",
    "OrcaError",
    "ChatRequest",
    "ChatResponse",
    "Agent",
    "Session",
    "Message",
    "Skill",
    "Quota",
    "Webhook",
    "Integration",
    "HealthStatus",
]
