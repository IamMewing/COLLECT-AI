"""Tests for Phase 5: the AI voice call extension of the negotiation loop
(agent/execute.py's handle_voice_turn, agent/mock.py's mock_handle_voice_turn).

Same isolation and stubbing conventions as test_multichannel.py: no network,
no LLM calls — the negotiate agent's LLM call and send_text_message are
monkeypatched with fakes/stubs, and tests/conftest.py's autouse fixture
points every file-backed store at a throwaway temp directory.
"""

import agent.execute as execute_module
from agent.memory import get_conversation, start_conversation
from agent.mock import mock_handle_voice_turn, _MOCK_VOICE_TURN_LIMIT
from agent.models import NegotiationTurn


# ── mock_handle_voice_turn ────────────────────────────────────────────────


def test_opening_turn_starts_a_conversation_and_greets_by_name():
    result = mock_handle_voice_turn("INV-V-1", None, invoice={"client_name": "Acme", "phone": "+14155550900"})
    assert result["continue"] is True
    assert result["status"] == "continue_negotiating"
    assert "Acme" in result["say"]

    convo = get_conversation("INV-V-1")
    assert convo["status"] == "active"
    assert convo["recipient_phone"] == "+14155550900"
    assert convo["turns"][0]["role"] == "agent"
    assert convo["turns"][0]["channel"] == "phone"


def test_reactivates_a_resolved_conversation_instead_of_refusing_the_call():
    start_conversation("INV-V-2", client_name="Acme", recipient_phone="+14155550901")
    from agent.memory import set_conversation_status
    set_conversation_status("INV-V-2", "resolved")

    result = mock_handle_voice_turn("INV-V-2", None, invoice={"client_name": "Acme", "phone": "+14155550901"})
    assert result["continue"] is True
    assert get_conversation("INV-V-2")["status"] == "active"


def test_resolved_keyword_ends_the_call_and_resolves_the_conversation():
    mock_handle_voice_turn("INV-V-3", None, invoice={"client_name": "Acme", "phone": "+14155550902"})
    result = mock_handle_voice_turn("INV-V-3", "yeah I already paid that one", invoice={"client_name": "Acme"})
    assert result["continue"] is False
    assert result["status"] == "resolved"
    assert get_conversation("INV-V-3")["status"] == "resolved"


def test_escalate_keyword_ends_the_call_and_escalates():
    mock_handle_voice_turn("INV-V-4", None, invoice={"client_name": "Acme", "phone": "+14155550903"})
    result = mock_handle_voice_turn("INV-V-4", "this is unacceptable, get me a lawyer", invoice={"client_name": "Acme"})
    assert result["continue"] is False
    assert result["status"] == "escalate_to_human"
    assert get_conversation("INV-V-4")["status"] == "escalated"


def test_neutral_reply_keeps_negotiating():
    mock_handle_voice_turn("INV-V-5", None, invoice={"client_name": "Acme", "phone": "+14155550904"})
    result = mock_handle_voice_turn("INV-V-5", "can you give me a bit more time", invoice={"client_name": "Acme"})
    assert result["continue"] is True
    assert result["status"] == "continue_negotiating"


def test_turn_cap_wraps_up_the_call():
    mock_handle_voice_turn("INV-V-6", None, invoice={"client_name": "Acme", "phone": "+14155550905"})
    result = None
    for _ in range(_MOCK_VOICE_TURN_LIMIT + 1):
        result = mock_handle_voice_turn("INV-V-6", "let's keep talking about it", invoice={"client_name": "Acme"})
    assert result["continue"] is False
    assert result["status"] == "call_turn_limit_reached"


# ── handle_voice_turn (real path, LLM stubbed) ──────────────────────────


class _StubNegotiateAgent:
    """Same shape as test_multichannel.py's stub — stands in for the real
    Strands Agent returned by build_negotiate_agent."""

    def __init__(self, turn: NegotiationTurn):
        self._turn = turn
        self.calls = 0

    def __call__(self, _context):
        self.calls += 1

        class _Result:
            pass

        result = _Result()
        result.structured_output = self._turn
        return result


def test_real_opening_turn_speaks_the_agents_line_and_keeps_listening(monkeypatch):
    turn = NegotiationTurn(
        outcome="continue_negotiating",
        reply_body="Hi, this is the accounts team calling about an overdue invoice.",
        reasoning="test",
    )
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    result = execute_module.handle_voice_turn(
        "INV-V-10", None, invoice={"client_name": "Acme", "phone": "+14155550910"}
    )
    assert result == {"say": turn.reply_body, "continue": True, "status": "continue_negotiating"}

    convo = get_conversation("INV-V-10")
    assert convo["turns"][-1]["channel"] == "phone"
    assert convo["turns"][-1]["role"] == "agent"


def test_real_resolved_outcome_hangs_up_and_marks_resolved(monkeypatch):
    start_conversation("INV-V-11", client_name="Acme", recipient_phone="+14155550911")
    turn = NegotiationTurn(outcome="resolved", reasoning="client confirmed payment")
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    result = execute_module.handle_voice_turn("INV-V-11", "I already paid it last week", invoice=None)
    assert result["continue"] is False
    assert result["status"] == "resolved"
    assert get_conversation("INV-V-11")["status"] == "resolved"
    # resolved with no reply_body still gets a spoken sign-off, not dead air
    assert result["say"]


def test_real_escalate_outcome_hangs_up_and_marks_escalated(monkeypatch):
    start_conversation("INV-V-12", client_name="Acme", recipient_phone="+14155550912")
    turn = NegotiationTurn(outcome="escalate_to_human", reasoning="hostile")
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    result = execute_module.handle_voice_turn("INV-V-12", "get me your manager now", invoice=None)
    assert result["continue"] is False
    assert result["status"] == "escalate_to_human"
    assert get_conversation("INV-V-12")["status"] == "escalated"


def test_a_minted_payment_link_is_texted_not_spoken(monkeypatch):
    start_conversation("INV-V-13", client_name="Acme", recipient_phone="+14155550913")
    turn = NegotiationTurn(
        outcome="continue_negotiating",
        reply_body="Great — I'll text that payment link to you right now.",
        paypal_order_id="ORDER-1",
        payment_link="https://paypal.example/pay/ORDER-1",
        reasoning="amount agreed",
    )
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    texted = {}

    def fake_send_text_message(to_phone, body, opens_session=False):
        texted["to_phone"] = to_phone
        texted["body"] = body
        texted["opens_session"] = opens_session
        return {"status": "sent", "channel_used": "sms", "real_send": True, "recipient": to_phone, "message_sid": "SM2"}

    monkeypatch.setattr(execute_module, "send_text_message", fake_send_text_message)

    result = execute_module.handle_voice_turn("INV-V-13", "yes let's do that", invoice=None)

    assert texted["to_phone"] == "+14155550913"
    assert "https://paypal.example/pay/ORDER-1" in texted["body"]
    assert texted["opens_session"] is False
    # the spoken line itself never contains the raw link
    assert "https://" not in result["say"]


def test_llm_failure_ends_the_call_gracefully_and_escalates(monkeypatch):
    start_conversation("INV-V-14", client_name="Acme", recipient_phone="+14155550914")

    class _Boom:
        def __call__(self, _context):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _Boom())

    result = execute_module.handle_voice_turn("INV-V-14", "hello?", invoice=None)
    assert result["continue"] is False
    assert result["status"] == "escalate_to_human"
    assert get_conversation("INV-V-14")["status"] == "escalated"


def test_turn_cap_wraps_up_without_calling_the_llm_again(monkeypatch):
    start_conversation("INV-V-15", client_name="Acme", recipient_phone="+14155550915")
    turn = NegotiationTurn(outcome="continue_negotiating", reply_body="Let's keep going.", reasoning="test")
    stub = _StubNegotiateAgent(turn)
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: stub)

    for _ in range(execute_module.MAX_VOICE_TURNS):
        result = execute_module.handle_voice_turn("INV-V-15", "still talking", invoice=None)
        assert result["continue"] is True

    calls_before_cap = stub.calls
    result = execute_module.handle_voice_turn("INV-V-15", "still talking", invoice=None)
    assert result["continue"] is False
    assert result["status"] == "call_turn_limit_reached"
    # the cap check happens before the LLM call, so no extra call was made
    assert stub.calls == calls_before_cap
