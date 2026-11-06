"""Tests for negotiated payment plans: storage (agent/memory.py),
auto-billing of due installments and the installment-paid webhook path
(agent/execute.py), and the plan-creation branch inside
handle_incoming_reply when the negotiate agent commits to a multi-payment
plan. No real network call anywhere — PayPal order creation and email
sending are monkeypatched with fakes, and the negotiate agent's LLM call is
replaced with a stub returning a crafted NegotiationTurn, the same way the
rest of this suite avoids needing a model or real credentials.
"""

from datetime import datetime, timedelta, timezone

import agent.execute as execute_module
from agent.memory import (
    create_payment_plan,
    get_payment_plan,
    update_installment,
    list_active_payment_plans,
    start_conversation,
)
from agent.models import NegotiationTurn, PlanInstallment


def _iso(dt):
    return dt.isoformat()


# ── Storage (agent/memory.py) ─────────────────────────────────────────────


def test_create_payment_plan_stores_every_installment_as_scheduled():
    installments = [
        {"index": 0, "amount_usd": 10.0, "description": "1 of 2", "due_at": _iso(datetime.now(timezone.utc)), "status": "scheduled", "paypal_order_id": None, "payment_link": None},
        {"index": 1, "amount_usd": 10.0, "description": "2 of 2", "due_at": _iso(datetime.now(timezone.utc) + timedelta(days=30)), "status": "scheduled", "paypal_order_id": None, "payment_link": None},
    ]
    plan = create_payment_plan("INV-PLAN-1", client_name="Acme", installments=installments)
    assert plan["status"] == "active"
    assert len(plan["installments"]) == 2
    assert get_payment_plan("INV-PLAN-1") == plan


def test_update_installment_merges_fields_by_index():
    installments = [{"index": 0, "amount_usd": 10.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))}]
    create_payment_plan("INV-PLAN-2", client_name="Acme", installments=installments)

    plan = update_installment("INV-PLAN-2", 0, status="awaiting_payment", paypal_order_id="PP-1")
    assert plan["installments"][0]["status"] == "awaiting_payment"
    assert plan["installments"][0]["paypal_order_id"] == "PP-1"
    assert plan["status"] == "active"  # not all paid yet


def test_plan_completes_only_once_every_installment_is_paid():
    installments = [
        {"index": 0, "amount_usd": 10.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))},
        {"index": 1, "amount_usd": 10.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))},
    ]
    create_payment_plan("INV-PLAN-3", client_name="Acme", installments=installments)

    plan = update_installment("INV-PLAN-3", 0, status="paid")
    assert plan["status"] == "active"  # only one of two paid

    plan = update_installment("INV-PLAN-3", 1, status="paid")
    assert plan["status"] == "completed"


def test_update_installment_on_unknown_invoice_returns_none():
    assert update_installment("INV-NEVER-SEEN-PLAN", 0, status="paid") is None


def test_list_active_payment_plans_excludes_completed_ones():
    create_payment_plan("INV-PLAN-4", client_name="A", installments=[{"index": 0, "amount_usd": 5.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))}])
    create_payment_plan("INV-PLAN-5", client_name="B", installments=[{"index": 0, "amount_usd": 5.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))}])
    update_installment("INV-PLAN-5", 0, status="paid")  # completes it (single installment)

    active_ids = {p["invoice_id"] for p in list_active_payment_plans()}
    assert "INV-PLAN-4" in active_ids
    assert "INV-PLAN-5" not in active_ids


# ── process_due_installments (auto-billing) ───────────────────────────────


def test_process_due_installments_bills_only_whats_actually_due(monkeypatch):
    start_conversation("INV-PLAN-6", client_name="Acme", recipient_email="client@example.com")
    now = datetime.now(timezone.utc)
    create_payment_plan("INV-PLAN-6", client_name="Acme", installments=[
        {"index": 0, "amount_usd": 20.0, "description": "due now", "status": "scheduled", "due_at": _iso(now - timedelta(minutes=1))},
        {"index": 1, "amount_usd": 20.0, "description": "due later", "status": "scheduled", "due_at": _iso(now + timedelta(days=30))},
    ])

    created_orders = []

    def fake_create_paypal_order(invoice_id, client_name, amount_usd, description):
        created_orders.append((invoice_id, amount_usd))
        return {"paypal_order_id": "PP-AUTO-1", "payment_link": "https://pay.example/1", "status": "CREATED"}

    monkeypatch.setattr(execute_module, "create_paypal_order", fake_create_paypal_order)
    monkeypatch.setattr(execute_module, "send_message", lambda *a, **k: {"status": "sent", "real_send": False, "recipient": "client@example.com"})

    results = execute_module.process_due_installments()

    assert len(created_orders) == 1  # only the due one was billed
    assert created_orders[0] == ("INV-PLAN-6", 20.0)
    assert results[0]["status"] == "billed"

    plan = get_payment_plan("INV-PLAN-6")
    assert plan["installments"][0]["status"] == "awaiting_payment"
    assert plan["installments"][0]["paypal_order_id"] == "PP-AUTO-1"
    assert plan["installments"][1]["status"] == "scheduled"  # untouched


def test_process_due_installments_skips_already_billed_or_paid_ones(monkeypatch):
    now = datetime.now(timezone.utc)
    create_payment_plan("INV-PLAN-7", client_name="Acme", installments=[
        {"index": 0, "amount_usd": 20.0, "status": "awaiting_payment", "due_at": _iso(now - timedelta(days=1))},
        {"index": 1, "amount_usd": 20.0, "status": "paid", "due_at": _iso(now - timedelta(days=1))},
    ])

    calls = []
    monkeypatch.setattr(execute_module, "create_paypal_order", lambda **k: calls.append(k) or {"paypal_order_id": "x", "payment_link": "y"})

    execute_module.process_due_installments()
    assert calls == []  # neither installment is 'scheduled', so nothing should be billed


def test_process_due_installments_records_a_billing_failure_without_crashing(monkeypatch):
    start_conversation("INV-PLAN-8", client_name="Acme", recipient_email="client@example.com")
    now = datetime.now(timezone.utc)
    create_payment_plan("INV-PLAN-8", client_name="Acme", installments=[
        {"index": 0, "amount_usd": 20.0, "status": "scheduled", "due_at": _iso(now - timedelta(minutes=1))},
    ])
    monkeypatch.setattr(execute_module, "create_paypal_order", lambda **k: {"error": "PayPal down"})

    results = execute_module.process_due_installments()
    assert results[0]["status"] == "billing_failed"
    # Must not have been silently marked as billed/paid.
    assert get_payment_plan("INV-PLAN-8")["installments"][0]["status"] == "scheduled"


# ── handle_installment_paid (webhook path) ────────────────────────────────


def test_handle_installment_paid_marks_only_that_installment():
    create_payment_plan("INV-PLAN-9", client_name="Acme", installments=[
        {"index": 0, "amount_usd": 10.0, "status": "awaiting_payment", "due_at": _iso(datetime.now(timezone.utc))},
        {"index": 1, "amount_usd": 10.0, "status": "scheduled", "due_at": _iso(datetime.now(timezone.utc))},
    ])

    outcome = execute_module.handle_installment_paid("INV-PLAN-9", 0, paypal_order_id="PP-1")
    assert outcome["status"] == "partial"
    plan = get_payment_plan("INV-PLAN-9")
    assert plan["installments"][0]["status"] == "paid"
    assert plan["installments"][1]["status"] == "scheduled"  # unaffected


def test_handle_installment_paid_on_the_last_one_completes_the_plan():
    create_payment_plan("INV-PLAN-10", client_name="Acme", installments=[
        {"index": 0, "amount_usd": 10.0, "status": "paid", "due_at": _iso(datetime.now(timezone.utc))},
        {"index": 1, "amount_usd": 10.0, "status": "awaiting_payment", "due_at": _iso(datetime.now(timezone.utc))},
    ])

    outcome = execute_module.handle_installment_paid("INV-PLAN-10", 1, paypal_order_id="PP-2")
    assert outcome["status"] == "completed"
    assert get_payment_plan("INV-PLAN-10")["status"] == "completed"


def test_handle_installment_paid_for_unknown_invoice_errors_cleanly():
    outcome = execute_module.handle_installment_paid("INV-NEVER-SEEN", 0)
    assert outcome["status"] == "error"


# ── handle_incoming_reply: the plan-creation branch ───────────────────────


class _StubNegotiateAgent:
    """Stands in for the real Strands Agent returned by build_negotiate_agent —
    .__call__ returns an object with .structured_output, exactly like a real
    agent run's result does, so handle_incoming_reply's plan-creation logic
    (real Python, not prompting) gets exercised without any model call."""

    def __init__(self, turn: NegotiationTurn):
        self._turn = turn

    def __call__(self, _context):
        class _Result:
            pass
        result = _Result()
        result.structured_output = self._turn
        return result


def test_handle_incoming_reply_creates_a_plan_when_the_agent_commits_to_one(monkeypatch):
    start_conversation("INV-PLAN-11", client_name="Acme", recipient_email="client@example.com")

    turn = NegotiationTurn(
        outcome="continue_negotiating",
        reply_subject="Re: Invoice [INV-PLAN-11]",
        reply_body="Here's your plan. Pay instantly via PayPal: https://pay.example/first",
        proposed_plan="2 installments of $20 each",
        installments=[
            PlanInstallment(amount_usd=20.0, due_in_days=0, description="Installment 1 of 2"),
            PlanInstallment(amount_usd=20.0, due_in_days=30, description="Installment 2 of 2"),
        ],
        paypal_order_id="PP-FIRST",
        payment_link="https://pay.example/first",
        reasoning="Client can't pay in full; agreed to a 2-part plan.",
    )
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    outcome = execute_module.handle_incoming_reply({
        "invoice_id": "INV-PLAN-11", "from_email": "client@example.com",
        "subject": "Re: Invoice [INV-PLAN-11]", "body": "I can't pay it all at once, can we split it?",
    })

    assert outcome["status"] == "continue_negotiating"
    assert outcome["payment_plan_created"] is True

    plan = get_payment_plan("INV-PLAN-11")
    assert plan is not None
    assert len(plan["installments"]) == 2
    # The order the agent already minted this turn should be attached to
    # installment 0, not left for process_due_installments to bill again.
    assert plan["installments"][0]["status"] == "awaiting_payment"
    assert plan["installments"][0]["paypal_order_id"] == "PP-FIRST"
    assert plan["installments"][1]["status"] == "scheduled"


def test_handle_incoming_reply_does_not_create_a_plan_for_a_single_lump_sum(monkeypatch):
    start_conversation("INV-PLAN-12", client_name="Acme", recipient_email="client@example.com")

    turn = NegotiationTurn(
        outcome="continue_negotiating",
        reply_subject="Re: Invoice [INV-PLAN-12]",
        reply_body="Great, here's a link for the full amount.",
        installments=None,
        reasoning="Client agreed to pay in full, no plan needed.",
    )
    monkeypatch.setattr(execute_module, "build_negotiate_agent", lambda: _StubNegotiateAgent(turn))

    outcome = execute_module.handle_incoming_reply({
        "invoice_id": "INV-PLAN-12", "from_email": "client@example.com", "body": "I'll pay it all now.",
    })

    assert "payment_plan_created" not in outcome
    assert get_payment_plan("INV-PLAN-12") is None
