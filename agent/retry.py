"""Retry-with-backoff utility for Strands Agents to handle transient 503/5xx/ServerError spikes."""

import asyncio
import random
import sys
import time
from typing import Any, AsyncIterator
from strands.agent.base import AgentBase


def is_transient_error(exc: BaseException) -> bool:
    """Return True if exc represents a transient server/capacity error suitable for retry."""
    # 1. Google GenAI ServerError (e.g. 503 Service Unavailable / high demand)
    try:
        from google.genai.errors import ServerError, APIError
        if isinstance(exc, ServerError):
            return True
        if isinstance(exc, APIError):
            code = getattr(exc, "code", getattr(exc, "status_code", None))
            if code and code >= 500:
                return True
    except ImportError:
        pass

    # 2. Strands ModelThrottledException
    try:
        from strands.types.exceptions import ModelThrottledException
        if isinstance(exc, ModelThrottledException):
            return True
    except ImportError:
        pass

    # 3. String-based inspection for 503, 500, 502, 504, UNAVAILABLE, etc.
    msg = str(exc).lower()
    transient_indicators = (
        "503",
        "service unavailable",
        "unavailable",
        "high demand",
        "no capacity available",
        "temporarily unavailable",
        "resource_exhausted",
        "throttled",
        "servererror",
        "gateway timeout",
        "504",
        "502",
        "500 internal",
    )
    return any(ind in msg for ind in transient_indicators)


def calculate_backoff(attempt: int, base_delay: float = 1.0) -> float:
    """Exponential backoff with jitter (~1s, 2s, 4s)."""
    # 2^(attempt-1) gives 1.0, 2.0, 4.0 for attempts 1, 2, 3
    backoff = base_delay * (2 ** (attempt - 1))
    jitter = random.uniform(0.1, 0.4)
    return backoff + jitter


class RetryAgentWrapper:
    """Wraps any Strands Agent (or AgentBase) to retry on transient ServerError / 503 spikes.

    Implements the AgentBase protocol (stream_async, invoke_async, __call__) so it can be used
    directly in Strands GraphBuilder nodes as well as standalone agent calls.
    """

    def __init__(self, agent: Any, max_retries: int = 3, base_delay: float = 1.0):
        self._agent = agent
        self.max_retries = max_retries
        self.base_delay = base_delay

    @property
    def agent_name(self) -> str:
        return getattr(self._agent, "name", "agent")

    def __getattr__(self, name: str) -> Any:
        return getattr(self._agent, name)

    def __call__(self, prompt: Any = None, **kwargs: Any) -> Any:
        """Synchronous invocation with retry and backoff."""
        for attempt in range(1, self.max_retries + 2):
            try:
                return self._agent(prompt, **kwargs)
            except Exception as exc:
                if attempt <= self.max_retries and is_transient_error(exc):
                    delay = calculate_backoff(attempt, self.base_delay)
                    sys.stderr.write(
                        f"\n⚠️ [RetryAgentWrapper] Transient error on '{self.agent_name}' "
                        f"(retry {attempt}/{self.max_retries}): {exc}. "
                        f"Retrying in {delay:.2f}s...\n"
                    )
                    sys.stderr.flush()
                    time.sleep(delay)
                    continue
                raise

    async def invoke_async(self, prompt: Any = None, **kwargs: Any) -> Any:
        """Asynchronous invocation with retry and backoff."""
        for attempt in range(1, self.max_retries + 2):
            try:
                return await self._agent.invoke_async(prompt, **kwargs)
            except Exception as exc:
                if attempt <= self.max_retries and is_transient_error(exc):
                    delay = calculate_backoff(attempt, self.base_delay)
                    sys.stderr.write(
                        f"\n⚠️ [RetryAgentWrapper] Transient error on '{self.agent_name}' "
                        f"(retry {attempt}/{self.max_retries}): {exc}. "
                        f"Retrying in {delay:.2f}s...\n"
                    )
                    sys.stderr.flush()
                    await asyncio.sleep(delay)
                    continue
                raise

    async def stream_async(self, prompt: Any = None, **kwargs: Any) -> AsyncIterator[Any]:
        """Streaming async invocation with retry and backoff."""
        for attempt in range(1, self.max_retries + 2):
            try:
                async for event in self._agent.stream_async(prompt, **kwargs):
                    yield event
                return
            except Exception as exc:
                if attempt <= self.max_retries and is_transient_error(exc):
                    delay = calculate_backoff(attempt, self.base_delay)
                    sys.stderr.write(
                        f"\n⚠️ [RetryAgentWrapper] Transient error on '{self.agent_name}' "
                        f"(retry {attempt}/{self.max_retries}): {exc}. "
                        f"Retrying in {delay:.2f}s...\n"
                    )
                    sys.stderr.flush()
                    await asyncio.sleep(delay)
                    continue
                raise


def with_retry(agent: Any, max_retries: int = 3, base_delay: float = 1.0) -> RetryAgentWrapper:
    """Helper to wrap an agent with RetryAgentWrapper."""
    if isinstance(agent, RetryAgentWrapper):
        return agent
    return RetryAgentWrapper(agent, max_retries=max_retries, base_delay=base_delay)
