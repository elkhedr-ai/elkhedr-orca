"""
Type definitions for the Orca Python client.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ChatRequest:
    message: str
    agent: Optional[str] = None
    level: str = "Auto"
    session_id: Optional[str] = None
    sandbox: bool = False

    def to_dict(self) -> dict:
        d = {"message": self.message, "level": self.level, "sandbox": self.sandbox}
        if self.agent:
            d["agent"] = self.agent
        if self.session_id:
            d["sessionId"] = self.session_id
        return d


@dataclass
class ChatResponse:
    response: str
    session_id: str
    agent: str
    model: str
    tokens: dict
    cost: float
    duration: float


@dataclass
class Agent:
    name: str
    model: str
    system_prompt: str
    skills: list[str] = field(default_factory=list)
    fallback_model: Optional[str] = None


@dataclass
class Session:
    id: str
    user_id: int
    agent: str
    status: str
    created_at: str
    updated_at: str


@dataclass
class Message:
    role: str
    content: str
    timestamp: str
    model: Optional[str] = None
    tokens: Optional[int] = None


@dataclass
class Skill:
    name: str
    description: str
    parameters: dict = field(default_factory=dict)
    enabled: bool = True


@dataclass
class Quota:
    limits: dict
    used: dict
    reset_at: str


@dataclass
class Webhook:
    id: int
    url: str
    events: list[str]
    active: bool
    created_at: str
    description: Optional[str] = None


@dataclass
class Integration:
    id: int
    provider: str
    name: str
    active: bool
    created_at: str
    last_test_status: Optional[str] = None


@dataclass
class HealthStatus:
    status: str
    version: str
    uptime: float
    components: dict = field(default_factory=dict)
