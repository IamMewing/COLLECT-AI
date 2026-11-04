"""Tests for the plan/branch decision in agent/mock.py's mock_run_sweep.

This mirrors the real plan agent's system-prompt rules in agents.py (see
the comment in mock.py right above the branch logic) — it's deterministic
Python, not a model call, which is exactly what makes it worth pinning
down with tests: a prompt can't regress silently the way a comment
claiming "mirrors X" can.

The three branches:
  - no_action:  probability >= 85 (regardless of risk)
  - standard:   risk is Low/Medium AND probability >= 50
  - escalation: everything else (either risk is High/Critical, or
                probability < 50 regardless of risk)

Each invoice dict below was chosen so its risk score/category and payment
probability were verified independently (see tests/test_risk.py and
tests/test_probability.py for those formulas in isolation) to land in the
exact region needed to exercise one branch — not tuned by trial-and-error
against this function itself.
"""

from agent.mock import mock_run_sweep


def _invoice(**overrides):
    base = dict(
        invoice_id="INV-TEST",
        client_name="Branch Test Co",
        amount=10_000,
        days_overdue=0,
        ignored_reminders=0,
        relationship_score=100,
        historical_on_time_rate=0.9,
    )
    base.update(overrides)
    return base


def test_high_probability_takes_no_action_regardless_of_risk():
    # risk=1 (Low), probability=90 (>=85) -> no_action
    invoice = _invoice(days_overdue=0, amount=10_000, ignored_reminders=0, relationship_score=100, historical_on_time_rate=0.9)
    result = mock_run_sweep(invoice)

    assert result["probability"].probability == 90
    assert result["plan"].branch == "no_action"
    assert result["plan"].channel == "none"
    assert result["plan"].tone == "none"
    # No point drafting a message nobody will see.
    assert result["draft"] is None


def test_low_risk_decent_probability_is_standard_chase():
    # risk=20 (Low), probability=75 (50 <= 75 < 85) -> standard
    invoice = _invoice(days_overdue=10, amount=50_000, ignored_reminders=0, relationship_score=80, historical_on_time_rate=0.8)
    result = mock_run_sweep(invoice)

    assert result["risk"].category == "Low"
    assert result["probability"].probability == 75
    assert result["plan"].branch == "standard"
    assert result["plan"].channel == "email"
    assert result["plan"].tone == "friendly"
    assert result["draft"] is not None
    assert result["draft"].channel == "email"


def test_critical_risk_overrides_a_merely_mediocre_probability():
    # risk=94 (Critical), probability=14 -- high risk alone is enough to
    # escalate even though probability is nowhere near the no_action cutoff.
    invoice = _invoice(days_overdue=40, amount=500_000, ignored_reminders=3, relationship_score=30, historical_on_time_rate=0.7)
    result = mock_run_sweep(invoice)

    assert result["risk"].category == "Critical"
    assert result["plan"].branch == "escalation"
    assert result["plan"].channel == "email"
    assert result["plan"].tone == "firm"
    assert result["draft"] is not None


def test_low_probability_escalates_even_with_medium_risk():
    # risk=34 (Medium, so the risk-based condition for "standard" is met)
    # but probability=0 -- the probability floor still forces escalation
    # rather than a plain standard chase.
    invoice = _invoice(days_overdue=5, amount=10_000, ignored_reminders=4, relationship_score=90, historical_on_time_rate=0.3)
    result = mock_run_sweep(invoice)

    assert result["risk"].category == "Medium"
    assert result["probability"].probability == 0
    assert result["plan"].branch == "escalation"


def test_draft_subject_and_body_reference_the_actual_invoice():
    invoice = _invoice(invoice_id="INV-9001", client_name="Northwind Traders", amount=67_000, days_overdue=22)
    result = mock_run_sweep(invoice)

    assert result["draft"] is not None
    assert "INV-9001" in result["draft"].subject
    assert "Northwind Traders" in result["draft"].body
    assert "22 days" in result["draft"].body


def test_a_returning_client_with_persisted_memory_uses_the_stored_score_not_the_invoice_default():
    # First sweep seeds the client's memory from the invoice's own
    # relationship_score (70). A second sweep with a *different* value on
    # the invoice should still use the stored 70, proving memory — not the
    # latest invoice payload — is the source of truth for a known client.
    from agent.memory import update_client_memory
    from agent.models import Reflection

    client_name = "Memory Continuity Co"
    first = _invoice(client_name=client_name, relationship_score=70, days_overdue=10, amount=50_000)
    mock_run_sweep(first)
    update_client_memory(
        client_name,
        Reflection(was_best_decision=True, suggested_tone_shift="fine", suggested_relationship_delta=0),
        action_taken="approved_and_sent",
        invoice=first,
    )

    # This invoice claims a much worse relationship_score (10), but the
    # client already has a memory record seeded at 70 — that's what should
    # actually get used for the risk/probability math.
    second = _invoice(client_name=client_name, relationship_score=10, days_overdue=10, amount=50_000)
    result = mock_run_sweep(second)

    # risk_formula(days_overdue=10, amount=50_000, ignored_reminders=0,
    # relationship_score=70): lateness=12, exposure=5, reminders=0,
    # relationship=max(0,(100-70)/100*15)=4.5 -> round(21.5)=22 (Low) --
    # NOT the score relationship_score=10 on this invoice would produce.
    assert result["risk"].score == 22
    assert result["risk"].category == "Low"
