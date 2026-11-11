"""Tests for the floating assistant's bridge handler
(server/agent_bridge.py's handle_assistant).

The model call itself is stubbed, same trade-off test_multichannel.py makes
for the negotiate agent: what's worth testing here is the part this project
is actually responsible for — that the context handed to the model is built
from real ledger/history/conversation data, that a missing piece of that
context degrades instead of raising, and that money is formatted the way the
prompt claims it is. Whether Gemini then writes a good sentence is not
something a unit test can assert.
"""

import importlib
import sys
from pathlib import Path

import pytest

# server/ isn't a package — same path dance smoke_test.py and the bridge
# itself do, so `import agent_bridge` resolves.
SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import agent_bridge  # noqa: E402


INVOICES = [
    {
        "invoice_id": "INV-2001", "client_name": "Teja Test", "amount": 120000,
        "days_overdue": 21, "ignored_reminders": 2, "status": "active",
        "email": "teja@example.com",
    },
    {
        "invoice_id": "INV-2002", "client_name": "Priya Nair", "amount": 45000,
        "days_overdue": 5, "ignored_reminders": 0, "status": "paid",
        "phone": "+919876543210",
    },
]


# ── Money formatting ───────────────────────────────────────────────────────


@pytest.mark.parametrize("amount,expected", [
    (0, "₹0"),
    (999, "₹999"),
    (1000, "₹1,000"),
    (99999, "₹99,999"),
    (100000, "₹1,00,000"),
    (120000, "₹1,20,000"),
    (10000000, "₹1,00,00,000"),
    (1234.6, "₹1,235"),          # rounds, doesn't truncate
])
def test_inr_uses_indian_digit_grouping(amount, expected):
    assert agent_bridge._inr(amount) == expected


def test_inr_passes_through_nonsense_rather_than_raising():
    # Context-building must never be the thing that fails a question.
    assert agent_bridge._inr(None) == "None"
    assert agent_bridge._inr("n/a") == "n/a"


# ── Mock mode ──────────────────────────────────────────────────────────────


def test_mock_mode_answers_without_touching_a_model(monkeypatch):
    monkeypatch.setattr(agent_bridge, "USE_MOCK", True)
    result = agent_bridge.handle_assistant({"question": "who owes me the most?", "invoices": INVOICES})
    assert result["mock"] is True
    # Only the unpaid one counts toward what's owed.
    assert "₹1,20,000" in result["answer"]


def test_an_empty_question_is_answered_not_raised(monkeypatch):
    monkeypatch.setattr(agent_bridge, "USE_MOCK", True)
    assert "answer" in agent_bridge.handle_assistant({"question": "   ", "invoices": INVOICES})


# ── Real mode: the context handed to the model ─────────────────────────────


class _StubAgent:
    """Stands in for the Strands Agent — records the prompt it was asked."""

    def __init__(self):
        self.prompt = None

    def __call__(self, prompt):
        self.prompt = prompt
        return "stub answer"


@pytest.fixture
def captured_prompt(monkeypatch):
    """Runs handle_assistant in real mode with the model stubbed, and hands
    back whatever prompt text the agent was called with."""
    stub = _StubAgent()
    monkeypatch.setattr(agent_bridge, "USE_MOCK", False)

    import agent.agents as agents_module
    monkeypatch.setattr(agents_module, "build_assistant_agent", lambda: stub)
    return stub


def test_real_mode_puts_the_ledger_in_the_prompt(captured_prompt):
    result = agent_bridge.handle_assistant({"question": "who owes me?", "invoices": INVOICES})

    assert result["answer"] == "stub answer"
    assert result["mock"] is False

    prompt = captured_prompt.prompt
    assert "INV-2001" in prompt and "Teja Test" in prompt
    assert "₹1,20,000" in prompt           # formatted, not raw 120000
    assert "21 days overdue" in prompt
    assert "status: paid" in prompt         # status carried through, not dropped
    assert "teja@example.com" in prompt
    assert "QUESTION: who owes me?" in prompt


def test_an_invoice_with_no_contact_is_described_as_such(captured_prompt):
    agent_bridge.handle_assistant({
        "question": "anything",
        "invoices": [{"invoice_id": "INV-9", "client_name": "No Contact Co", "amount": 100}],
    })
    assert "no contact on file" in captured_prompt.prompt


def test_an_empty_ledger_still_builds_a_usable_prompt(captured_prompt):
    agent_bridge.handle_assistant({"question": "how am I doing?", "invoices": []})
    prompt = captured_prompt.prompt
    assert "no invoices on the books yet" in prompt
    assert "nothing sent yet" in prompt
    assert "(none active)" in prompt


def test_a_failing_history_lookup_does_not_sink_the_question(captured_prompt, monkeypatch):
    # Firestore being briefly unavailable should cost the answer some
    # context, not turn the question into an error.
    import agent.memory as memory_module
    monkeypatch.setattr(
        memory_module, "list_message_history",
        lambda limit=100: (_ for _ in ()).throw(RuntimeError("firestore down")),
    )
    result = agent_bridge.handle_assistant({"question": "anything", "invoices": INVOICES})
    assert result["answer"] == "stub answer"
    assert "nothing sent yet" in captured_prompt.prompt
