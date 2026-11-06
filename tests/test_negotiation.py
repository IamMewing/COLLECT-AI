"""Tests for the autonomous negotiation loop: conversation-thread storage
(agent/memory.py), the mock negotiation decision logic (agent/mock.py's
mock_handle_incoming_reply — exercised here since it's deterministic and
needs no model call, same trade-off the rest of mock.py makes), the subject
tagging that lets replies be matched back to a conversation (agent/execute.py's
_tag_subject), and the pure-Python parsing helpers in agent/inbox.py.

No network calls, no IMAP connection, no LLM calls — isolated_agent_memory
in conftest.py points conversation storage at a throwaway tmp_path exactly
like it does for client memory and message history.
"""

from agent.memory import (
    get_conversation,
    start_conversation,
    append_conversation_turn,
    set_conversation_status,
)
from agent.mock import mock_handle_incoming_reply, mock_approve_and_execute
from agent.models import DraftedMessage
from agent.execute import _tag_subject
from agent.inbox import INVOICE_TAG_RE, _strip_quoted_reply


# ── Conversation-thread storage ──────────────────────────────────────────


def test_start_conversation_creates_an_active_empty_thread():
    convo = start_conversation("INV-9001", client_name="Northwind", recipient_email="a@b.com")
    assert convo["status"] == "active"
    assert convo["turns"] == []
    assert convo["client_name"] == "Northwind"
    assert get_conversation("INV-9001") == convo


def test_start_conversation_reactivates_without_wiping_history():
    start_conversation("INV-9002", client_name="Acme", recipient_email="a@b.com")
    append_conversation_turn("INV-9002", role="agent", body="first outreach", subject="s1")
    set_conversation_status("INV-9002", "resolved")

    # Chasing the same invoice again later should bring the thread back to
    # 'active' but keep the earlier turn — the agent should "remember" it.
    convo = start_conversation("INV-9002", client_name="Acme", recipient_email="a@b.com")
    assert convo["status"] == "active"
    assert len(convo["turns"]) == 1
    assert convo["turns"][0]["body"] == "first outreach"


def test_append_conversation_turn_accumulates_in_order():
    start_conversation("INV-9003", client_name="Acme", recipient_email="a@b.com")
    append_conversation_turn("INV-9003", role="agent", body="turn 1")
    append_conversation_turn("INV-9003", role="client", body="turn 2")
    convo = get_conversation("INV-9003")
    assert [t["role"] for t in convo["turns"]] == ["agent", "client"]
    assert [t["body"] for t in convo["turns"]] == ["turn 1", "turn 2"]


def test_set_conversation_status_on_missing_conversation_returns_none():
    assert set_conversation_status("INV-DOES-NOT-EXIST", "resolved") is None


def test_get_conversation_for_unknown_invoice_is_none():
    assert get_conversation("INV-NEVER-SEEN") is None


# ── mock_handle_incoming_reply: the three outcome branches ───────────────


def test_reply_with_no_invoice_tag_is_skipped():
    result = mock_handle_incoming_reply({"invoice_id": None, "from_email": "x@y.com", "subject": "Hi", "body": "hi"})
    assert result["status"] == "skipped"


def test_reply_for_untracked_invoice_is_skipped():
    result = mock_handle_incoming_reply({"invoice_id": "INV-UNKNOWN-9999", "from_email": "x@y.com", "body": "ok"})
    assert result["status"] == "skipped"


def test_reply_on_a_resolved_thread_is_skipped_not_reopened():
    start_conversation("INV-9010", client_name="Acme", recipient_email="a@b.com")
    set_conversation_status("INV-9010", "resolved")
    result = mock_handle_incoming_reply({"invoice_id": "INV-9010", "from_email": "a@b.com", "body": "still here"})
    assert result["status"] == "skipped"
    assert "resolved" in result["reason"]


def test_reply_confirming_payment_resolves_the_conversation():
    start_conversation("INV-9011", client_name="Acme", recipient_email="a@b.com")
    result = mock_handle_incoming_reply({
        "invoice_id": "INV-9011", "from_email": "a@b.com", "subject": "Re: [INV-9011]",
        "body": "Hi, this is already paid, sent it last week.",
    })
    assert result["status"] == "resolved"
    assert get_conversation("INV-9011")["status"] == "resolved"
    # The client's reply itself should still be recorded even though nothing
    # further gets sent back.
    assert len(get_conversation("INV-9011")["turns"]) == 1


def test_reply_disputing_the_invoice_escalates_to_a_human():
    start_conversation("INV-9012", client_name="Acme", recipient_email="a@b.com")
    result = mock_handle_incoming_reply({
        "invoice_id": "INV-9012", "from_email": "a@b.com",
        "body": "This is unacceptable, I never received these goods, get my lawyer involved.",
    })
    assert result["status"] == "escalate_to_human"
    assert get_conversation("INV-9012")["status"] == "escalated"


def test_an_ordinary_reply_continues_negotiating_and_drafts_a_plan():
    start_conversation("INV-9013", client_name="Acme", recipient_email="a@b.com")
    result = mock_handle_incoming_reply({
        "invoice_id": "INV-9013", "from_email": "a@b.com",
        "body": "Things are tight right now, can we work something out?",
    })
    assert result["status"] == "continue_negotiating"
    assert result["pending_human_review"] is True  # mock mode never auto-sends
    convo = get_conversation("INV-9013")
    # client turn + the agent's drafted follow-up, both recorded
    assert len(convo["turns"]) == 2
    assert convo["turns"][0]["role"] == "client"
    assert convo["turns"][1]["role"] == "agent"
    assert convo["status"] == "active"  # still open, not resolved/escalated


# ── mock_approve_and_execute opens a conversation thread on approval ─────


def test_approving_a_mock_email_draft_opens_a_conversation_thread():
    draft = DraftedMessage(subject="Overdue balance", body="Please settle this.", channel="email")
    invoice = {"invoice_id": "INV-9020", "email": "client@example.com"}
    mock_approve_and_execute(draft, approved=True, client_name="Acme", invoice=invoice)

    convo = get_conversation("INV-9020")
    assert convo is not None
    assert convo["status"] == "active"
    assert convo["recipient_email"] == "client@example.com"
    assert len(convo["turns"]) == 1
    assert convo["turns"][0]["role"] == "agent"


def test_rejecting_a_mock_draft_does_not_open_a_conversation_thread():
    draft = DraftedMessage(subject="Overdue balance", body="Please settle this.", channel="email")
    invoice = {"invoice_id": "INV-9021", "email": "client@example.com"}
    mock_approve_and_execute(draft, approved=False, client_name="Acme", invoice=invoice)

    assert get_conversation("INV-9021") is None


# ── Subject tagging (agent/execute.py) ────────────────────────────────────


def test_tag_subject_adds_the_invoice_tag_once():
    tagged = _tag_subject("Overdue balance", "INV-1042")
    assert "[INV-1042]" in tagged
    assert tagged.count("[INV-1042]") == 1


def test_tag_subject_does_not_duplicate_an_existing_tag():
    already_tagged = "Re: Overdue balance [INV-1042]"
    result = _tag_subject(already_tagged, "INV-1042")
    assert result.count("[INV-1042]") == 1


def test_tag_subject_with_no_invoice_id_falls_back_to_demo_label():
    result = _tag_subject("Hello", None)
    assert "[CollectAI demo]" in result


# ── Pure parsing helpers (agent/inbox.py) ─────────────────────────────────


def test_invoice_tag_regex_extracts_from_a_reply_subject():
    match = INVOICE_TAG_RE.search("Re: Invoice follow-up [INV-2001]")
    assert match is not None
    assert match.group(1) == "INV-2001"


def test_invoice_tag_regex_returns_none_for_unrelated_subject():
    assert INVOICE_TAG_RE.search("Weekly newsletter") is None


def test_strip_quoted_reply_removes_on_wrote_block():
    body = "Sounds good, I'll pay by Friday.\n\nOn Tue, Nov 4, 2026 at 3:00 PM J Doe <j@doe.com> wrote:\n> original message"
    assert _strip_quoted_reply(body) == "Sounds good, I'll pay by Friday."


def test_strip_quoted_reply_removes_gt_quoted_lines():
    body = "Okay noted.\n> previous line one\n> previous line two"
    assert _strip_quoted_reply(body) == "Okay noted."


def test_strip_quoted_reply_leaves_a_plain_body_untouched():
    body = "No quoted content here at all."
    assert _strip_quoted_reply(body) == body
