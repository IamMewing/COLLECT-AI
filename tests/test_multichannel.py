"""Tests for the multi-channel (WhatsApp/SMS) extension of the negotiation
loop and plan/draft channel selection: phone-based conversation lookup
(agent/memory.py's find_active_conversation_by_phone), inbound-text
resolution (agent/execute.py's handle_incoming_text /
agent/mock.py's mock_handle_incoming_text), channel-aware sending inside
handle_incoming_reply, and mock_run_sweep's contact-aware channel choice.

Same isolation and stubbing conventions as test_negotiation.py /
test_payment_plans.py: no network, no LLM calls — PayPal/Twilio sends and
the negotiate agent's LLM call are monkeypatched with fakes/stubs.
"""

import agent.execute as execute_module
from agent.memory import (
    start_conversation,
    append_conversation_turn,
    get_conversation,
    find_active_conversation_by_phone,
    set_conversation_status,
)
from agent.mock import mock_run_sweep, mock_handle_incoming_text
from agent.models import NegotiationTurn


# ── find_active_conversation_by_phone ─────────────────────────────────────


def test_finds_the_active_conversation_matching_a_phone_number():
    start_conversation("INV-SMS-1", client_name="Acme", recipient_phone="+14155550100")
    assert find_active_conversation_by_phone("+14155550100") == "INV-SMS-1"


def test_matches_regardless_of_whatsapp_prefix_or_formatting():
    start_conversation("INV-SMS-2", client_name="Acme", recipient_phone="+1 (415) 555-0101")
    assert find_active_conversation_by_phone("whatsapp:+14155550101") == "INV-SMS-2"


def test_does_not_match_a_resolved_conversation():
    start_conversation("INV-SMS-3", client_name="Acme", recipient_phone="+14155550102")
    set_conversation_status("INV-SMS-3", "resolved")
    assert find_active_conversation_by_phone("+14155550102") is None


def test_no_match_for_an_unknown_phone_number():
    assert find_active_conversation_by_phone("+10000000000") is None


# ── mock_run_sweep: channel choice respects what's actually on file ──────


def test_standard_branch_prefers_email_when_both_are_on_file():
    invoice = {
        "invoice_id": "INV-CH-1", "client_name": "Acme", "amount": 1000,
        "days_overdue": 10, "ignored_reminders": 1, "relationship_score": 70,
        "historical_on_time_rate": 0.8, "email": "a@b.com", "phone": "+14155550100",
    }
    result = mock_run_sweep(invoice)
    assert result["plan"].branch == "standard"
    assert result["plan"].channel == "email"
    assert result["draft"].channel == "email"


def test_standard_branch_falls_back_to_whatsapp_with_only_a_phone_on_file():
    invoice = {
        "invoice_id": "INV-CH-2", "client_name": "Acme", "amount": 1000,
        "days_overdue": 10, "ignored_reminders": 1, "relationship_score": 70,
        "historical_on_time_rate": 0.8, "phone": "+14155550100",
    }
    result = mock_run_sweep(invoice)
    assert result["plan"].branch == "standard"
    assert result["plan"].channel == "whatsapp"
    assert result["draft"].channel == "whatsapp"


def test_escalation_branch_prefers_whatsapp_when_a_phone_is_on_file():
    invoice = {
        "invoice_id": "INV-CH-3", "client_name": "Acme", "amount": 50000,
        "days_overdue": 90, "ignored_reminders": 4, "relationship_score": 20,
        "historical_on_time_rate": 0.1, "email": "a@b.com", "phone": "+14155550100",
    }
    result = mock_run_sweep(invoice)
    assert result["plan"].branch == "escalation"
    assert result["plan"].channel == "whatsapp"
    assert result["draft"].channel == "whatsapp"


def test_escalation_branch_never_picks_a_phone_channel_with_no_phone_on_file():
    invoice = {
        "invoice_id": "INV-CH-4", "client_name": "Acme", "amount": 50000,
        "days_overdue": 90, "ignored_reminders": 4, "relationship_score": 20,
        "historical_on_time_rate": 0.1, "email": "a@b.com",
    }
    result = mock_run_sweep(invoice)
    assert result["plan"].branch == "escalation"
    assert result["plan"].channel == "email"
    assert result["draft"].channel == "email"


# ── mock_handle_incoming_text: resolving which invoice a text belongs to ──


def test_incoming_text_resolves_by_invoice_tag_in_the_body():
    start_conversation("INV-TXT-1", client_name="Acme", recipient_phone="+14155550200")
    result = mock_handle_incoming_text("+19998887777", "Already paid this [INV-TXT-1]", channel="sms")
    # A different phone than the one on file, but the tag still resolves it.
    assert result["status"] == "resolved"
    assert get_conversation("INV-TXT-1")["status"] == "resolved"


def test_incoming_text_resolves_by_phone_when_no_tag_present():
    start_conversation("INV-TXT-2", client_name="Acme", recipient_phone="+14155550201")
    result = mock_handle_incoming_text("+14155550201", "things are tight, can we work something out?", channel="whatsapp")
    assert result["status"] == "continue_negotiating"
    convo = get_conversation("INV-TXT-2")
    assert convo["turns"][0]["channel"] == "whatsapp"


def test_incoming_text_with_no_match_is_skipped_not_crashed():
    result = mock_handle_incoming_text("+10000000099", "hello?", channel="sms")
    assert result["status"] == "skipped"
    assert result["from_phone"] == "+10000000099"


# ── handle_incoming_reply (real, stubbed agent): channel symmetry ────────


class _StubNegotiateAgent:
    """Stands in for the real Strands Agent returned by build_negotiate_agent
    (same shape test_payment_plans.py's stub uses: .__call__ returns an
    object with .structured_output)."""

    def __init__(self, turn: NegotiationTurn):
        self._turn = turn

    def __call__(self, _context):
        class _Result:
            pass

        result = _Result()
        result.structured_output = self._turn
        return result


def test_whatsapp_reply_gets_a_whatsapp_response_sent_with_an_open_session(monkeypatch):
    start_conversation("INV-RT-1", client_name="Acme", recipient_phone="+14155550300")

    turn = NegotiationTurn(
        outcome="continue_negotiating",
        reply_body="Thanks for the update — here's a plan.",
        reasoning="test",
    )
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    sent = {}

    def fake_send_whatsapp_message(to_phone, body, opens_session=False):
        sent["to_phone"] = to_phone
        sent["opens_session"] = opens_session
        return {"status": "sent", "channel_used": "whatsapp", "real_send": True, "recipient": to_phone, "message_sid": "wamid.1"}

    # WhatsApp sends go through Meta's Cloud API now (agent/tools/whatsapp_tools.py),
    # not Twilio's send_text_message — see execute.py's send_message().
    monkeypatch.setattr(execute_module, "send_whatsapp_message", fake_send_whatsapp_message)
    monkeypatch.setenv("AUTO_APPROVE_NEGOTIATION", "true")

    result = execute_module.handle_incoming_reply({
        "invoice_id": "INV-RT-1", "body": "can we work something out?", "channel": "whatsapp",
        "subject": None, "from_phone": "+14155550300",
    })

    assert result["status"] == "continue_negotiating"
    assert sent["to_phone"] == "+14155550300"
    assert sent["opens_session"] is True  # the inbound whatsapp message just opened the window
    convo = get_conversation("INV-RT-1")
    assert convo["turns"][-1]["channel"] == "whatsapp"
    assert convo["turns"][-1]["subject"] is None


def test_handle_incoming_text_resolves_by_phone_and_delegates(monkeypatch):
    start_conversation("INV-RT-2", client_name="Acme", recipient_phone="+14155550301")

    turn = NegotiationTurn(outcome="resolved", reasoning="paid")
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    result = execute_module.handle_incoming_text("+14155550301", "all paid now, thanks", channel="sms")

    assert result["status"] == "resolved"
    assert get_conversation("INV-RT-2")["status"] == "resolved"
