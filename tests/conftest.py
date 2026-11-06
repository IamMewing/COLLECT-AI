"""Shared pytest fixtures/setup for the whole suite.

`import agent` (transitively, via agent/__init__.py -> graph.py -> agents.py)
constructs an AnthropicModel at Agent-build time, which just needs *a*
string in ANTHROPIC_API_KEY to construct — it's never called over the
network by anything in this suite, since everything here either tests
pure functions (risk/probability) or the mock pipeline (no model calls at
all). Setting a placeholder here, once, before collection means individual
test files don't each need to remember to do this — same approach
smoke_test.py already uses at the repo root.
"""

import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-placeholder")

# Tests run from anywhere (`pytest`, `pytest tests/`, an IDE's test runner),
# but `agent` is a package at the repo root, not installed — put the repo
# root on sys.path the same way running `python smoke_test.py` from the
# repo root already does implicitly via cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture(autouse=True)
def isolated_agent_memory(tmp_path, monkeypatch):
    """Every test gets its own empty client-memory/message-history/
    conversation files instead of touching agent/data/*.json — the files the
    actual running demo reads and writes. Without this, a branch-logic test
    that calls mock_run_sweep (which persists via agent.memory) would
    silently edit the live demo's client relationship scores and message
    history every time the suite runs, exactly the kind of test pollution
    this session already hit once by hand (see the Firestore-fallback manual
    testing earlier) and had to clean up after.

    autouse so every test file gets this automatically — nobody writing a
    new test here has to remember to ask for it.
    """
    from agent import memory as memory_module

    monkeypatch.setattr(memory_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(memory_module, "MEMORY_FILE", tmp_path / "client_memory.json")
    monkeypatch.setattr(memory_module, "HISTORY_FILE", tmp_path / "message_history.json")
    monkeypatch.setattr(memory_module, "CONVERSATIONS_FILE", tmp_path / "conversations.json")
    monkeypatch.setattr(memory_module, "PAYMENT_PLANS_FILE", tmp_path / "payment_plans.json")
    # remember_invoice_score's cache is a plain module-level dict (not
    # file-backed), shared across the whole process — reset it too, or a
    # client name reused across tests could carry a score over.
    monkeypatch.setattr(memory_module, "_known_client_scores", {})
    yield
