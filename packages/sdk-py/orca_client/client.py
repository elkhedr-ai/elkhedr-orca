"""
Orca Python Client
Typed async/sync client for the Orca multi-agent orchestration API.
"""

from typing import Optional, Any
import httpx

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


class OrcaError(Exception):
    """Error returned by the Orca API."""

    def __init__(self, status: int, error: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.error = error
        self.details = details


class OrcaClient:
    """
    Synchronous client for the Orca API.

    Usage:
        client = OrcaClient(base_url="http://localhost:8001", api_key="...")
        response = client.chat(ChatRequest(message="Hello"))
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._token = token
        self._timeout = timeout
        self._client = httpx.Client(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Orca-SDK-Python/1.0",
        }
        if self._api_key:
            headers["X-API-Key"] = self._api_key
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _request(self, method: str, path: str, **kwargs) -> Any:
        url = f"{self.base_url}{path}"
        try:
            response = self._client.request(
                method, url, headers=self._headers(), **kwargs
            )
            data = response.json()
            if response.status_code >= 400:
                raise OrcaError(
                    status=response.status_code,
                    error=data.get("error", "UnknownError"),
                    message=data.get("message", f"HTTP {response.status_code}"),
                    details=data.get("details"),
                )
            return data
        except httpx.TimeoutException:
            raise OrcaError(0, "Timeout", f"Request timed out after {self._timeout}s")
        except httpx.RequestError as e:
            raise OrcaError(0, "NetworkError", str(e))

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ── Health ──────────────────────────────────────────────────────────────

    def get_health(self) -> HealthStatus:
        data = self._request("GET", "/health")
        return HealthStatus(
            status=data["status"],
            version=data["version"],
            uptime=data["uptime"],
            components=data.get("components", {}),
        )

    # ── Chat ────────────────────────────────────────────────────────────────

    def chat(self, request: ChatRequest) -> ChatResponse:
        data = self._request("POST", "/api/v1/chat", json=request.to_dict())
        return ChatResponse(
            response=data["response"],
            session_id=data["sessionId"],
            agent=data["agent"],
            model=data["model"],
            tokens=data["tokens"],
            cost=data["cost"],
            duration=data["duration"],
        )

    # ── Agents ──────────────────────────────────────────────────────────────

    def list_agents(self) -> list[Agent]:
        data = self._request("GET", "/api/v1/agents")
        return [
            Agent(
                name=a["name"],
                model=a["model"],
                system_prompt=a.get("systemPrompt", ""),
                skills=a.get("skills", []),
                fallback_model=a.get("fallbackModel"),
            )
            for a in data
        ]

    def get_agent(self, name: str) -> Agent:
        data = self._request("GET", f"/api/v1/agents/{name}")
        return Agent(
            name=data["name"],
            model=data["model"],
            system_prompt=data.get("systemPrompt", ""),
            skills=data.get("skills", []),
            fallback_model=data.get("fallbackModel"),
        )

    # ── Sessions ────────────────────────────────────────────────────────────

    def list_sessions(self) -> list[Session]:
        data = self._request("GET", "/api/v1/sessions")
        return [
            Session(
                id=s["id"],
                user_id=s["userId"],
                agent=s["agent"],
                status=s["status"],
                created_at=s["createdAt"],
                updated_at=s["updatedAt"],
            )
            for s in data
        ]

    def get_session(self, session_id: str) -> tuple[Session, list[Message]]:
        data = self._request("GET", f"/api/v1/sessions/{session_id}")
        session = Session(
            id=data["id"],
            user_id=data["userId"],
            agent=data["agent"],
            status=data["status"],
            created_at=data["createdAt"],
            updated_at=data["updatedAt"],
        )
        messages = [
            Message(
                role=m["role"],
                content=m["content"],
                timestamp=m["timestamp"],
                model=m.get("model"),
                tokens=m.get("tokens"),
            )
            for m in data.get("messages", [])
        ]
        return session, messages

    def delete_session(self, session_id: str) -> None:
        self._request("DELETE", f"/api/v1/sessions/{session_id}")

    # ── Skills ──────────────────────────────────────────────────────────────

    def list_skills(self) -> list[Skill]:
        data = self._request("GET", "/api/v1/skills")
        return [
            Skill(
                name=s["name"],
                description=s["description"],
                parameters=s.get("parameters", {}),
                enabled=s.get("enabled", True),
            )
            for s in data
        ]

    # ── Billing & Quotas ────────────────────────────────────────────────────

    def get_quota(self) -> tuple[Quota, Optional[str]]:
        data = self._request("GET", "/api/v1/billing/quotas/me")
        quota = Quota(
            limits=data["quota"]["limits"],
            used=data["quota"]["used"],
            reset_at=data["quota"]["resetAt"],
        )
        return quota, data.get("warning")

    # ── Webhooks ────────────────────────────────────────────────────────────

    def list_webhooks(self) -> list[Webhook]:
        data = self._request("GET", "/api/v1/webhooks")
        return [
            Webhook(
                id=w["id"],
                url=w["url"],
                events=w["events"],
                active=w["active"],
                created_at=w["createdAt"],
                description=w.get("description"),
            )
            for w in data["webhooks"]
        ]

    def create_webhook(
        self, url: str, events: list[str], description: Optional[str] = None
    ) -> Webhook:
        body = {"url": url, "events": events}
        if description:
            body["description"] = description
        data = self._request("POST", "/api/v1/webhooks", json=body)
        w = data["webhook"]
        return Webhook(
            id=w["id"],
            url=w["url"],
            events=w["events"],
            active=w["active"],
            created_at=w["createdAt"],
            description=w.get("description"),
        )

    def delete_webhook(self, webhook_id: int) -> None:
        self._request("DELETE", f"/api/v1/webhooks/{webhook_id}")

    # ── Integrations ────────────────────────────────────────────────────────

    def list_integrations(self) -> list[Integration]:
        data = self._request("GET", "/api/v1/integrations")
        return [
            Integration(
                id=i["id"],
                provider=i["provider"],
                name=i["name"],
                active=i["active"],
                created_at=i["createdAt"],
                last_test_status=i.get("lastTestStatus"),
            )
            for i in data["integrations"]
        ]

    def register_integration(
        self,
        provider: str,
        credentials: dict[str, str],
        name: Optional[str] = None,
    ) -> Integration:
        body = {"provider": provider, "credentials": credentials}
        if name:
            body["name"] = name
        data = self._request("POST", "/api/v1/integrations", json=body)
        i = data["integration"]
        return Integration(
            id=i["id"],
            provider=i["provider"],
            name=i["name"],
            active=i["active"],
            created_at=i["createdAt"],
            last_test_status=i.get("lastTestStatus"),
        )

    def test_integration(self, integration_id: int) -> dict:
        return self._request("POST", f"/api/v1/integrations/{integration_id}/test")

    def execute_integration_action(
        self, integration_id: int, action: str, params: Optional[dict] = None
    ) -> Any:
        return self._request(
            "POST",
            f"/api/v1/integrations/{integration_id}/actions",
            json={"action": action, "params": params or {}},
        )
