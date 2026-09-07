"""Mock mode — exercises the exact same output shapes as the real Graph
(RiskAssessment, ProbabilityAssessment, ActionPlan, DraftedMessage,
Reflection) with ZERO API calls. Nothing here touches strands.Agent,
strands.models, or ANTHROPIC_API_KEY — it's pure Python and templating.

Use this to build/test the frontend, the Approval Gate UI, and the
overall graph *shape* while you have no API credits or are waiting on
Bedrock access. When real access is available, run_demo.py's non-mock
path produces identically-shaped output — nothing downstream needs to
change when you switch over.
"""

from .tools.risk import calculate_risk_score
from .tools.probability import predict_payment_probability
from .models import RiskAssessment, ProbabilityAssessment, ActionPlan, DraftedMessage, Reflection
from .memory import (
    get_client_memory,
    update_client_memory,
    has_client_memory,
    remember_invoice_score,
    extract_client_name_from_draft,
)


def mock_run_sweep(invoice: dict) -> dict:
    """Same inputs/outputs shape as graph.run_sweep(), but deterministic
    Python instead of an LLM graph. No network calls at all.

    Args:
        invoice: dict with keys client_name, amount, days_overdue,
            ignored_reminders, relationship_score, historical_on_time_rate.

    Returns:
        dict with keys: risk (RiskAssessment), probability
        (ProbabilityAssessment), plan (ActionPlan), and draft
        (DraftedMessage | None — None if plan.branch == "no_action",
        exactly like the real graph).
    """
    # Remember invoice relationship_score so new client records seed from it
    remember_invoice_score(invoice)

    # Read persistent memory for client if a record exists
    client_name = invoice.get("client_name")
    relationship_score = invoice["relationship_score"]
    if client_name and has_client_memory(client_name):
        mem = get_client_memory(client_name, invoice=invoice)
        relationship_score = mem.get("relationship_score", relationship_score)

    risk_raw = calculate_risk_score(
        days_overdue=invoice["days_overdue"],
        amount=invoice["amount"],
        ignored_reminders=invoice["ignored_reminders"],
        relationship_score=relationship_score,
    )
    risk = RiskAssessment(
        score=risk_raw["score"],
        category=risk_raw["category"],
        reasoning=f"[MOCK] Deterministic score from calculate_risk_score: {risk_raw}",
    )

    prob_raw = predict_payment_probability(
        days_overdue=invoice["days_overdue"],
        ignored_reminders=invoice["ignored_reminders"],
        relationship_score=relationship_score,
        historical_on_time_rate=invoice["historical_on_time_rate"],
    )
    probability = ProbabilityAssessment(
        probability=prob_raw["probability"],
        explanation=f"[MOCK] {prob_raw['explanation']}",
    )

    # Mirrors the real plan agent's system-prompt rules in agents.py —
    # keep these two in sync if you tune the real prompt.
    if probability.probability >= 85:
        plan = ActionPlan(
            branch="no_action",
            channel="none",
            tone="none",
            reasoning="[MOCK] Probability >= 85, invoice likely resolves itself.",
        )
    elif risk.category in ("Low", "Medium") and probability.probability >= 50:
        plan = ActionPlan(
            branch="standard",
            channel="email",
            tone="friendly",
            reasoning="[MOCK] Low/Medium risk with reasonable payment probability.",
        )
    else:
        plan = ActionPlan(
            branch="escalation",
            channel="email",
            tone="firm",
            reasoning="[MOCK] High/Critical risk or low payment probability.",
        )

    draft = None
    if plan.branch != "no_action":
        client = invoice.get("client_name", "there")
        tone_opener = {
            "friendly": f"Hope you're doing well, {client}!",
            "firm": f"Hi {client}, following up on an overdue balance.",
            "urgent": f"Hi {client} — this needs prompt attention.",
        }.get(plan.tone, f"Hi {client},")
        draft = DraftedMessage(
            subject=f"[MOCK DRAFT] Invoice follow-up — {invoice.get('invoice_id', 'N/A')}",
            body=(
                f"{tone_opener}\n\n"
                f"[This is a MOCK, templated draft — not real Claude reasoning. "
                f"Real drafts will be written in your voice, tone-matched to this "
                f"client's history.]\n\n"
                f"Invoice amount: INR {invoice['amount']:,.0f}, "
                f"{invoice['days_overdue']} days overdue."
            ),
            channel=plan.channel if plan.channel in ("email", "whatsapp") else "email",
        )

    return {"risk": risk, "probability": probability, "plan": plan, "draft": draft}


def mock_approve_and_execute(
    draft: DraftedMessage,
    approved: bool,
    client_name: str | None = None,
    invoice: dict | None = None,
) -> dict:
    """Mock version of execute.approve_and_execute — no send, no LLM reflection call."""
    c_name = client_name or extract_client_name_from_draft(draft)

    if not approved:
        # Deterministic mock rule (-1 on rejection by human reviewer).
        # Not real LLM reasoning — just a fixed, predictable mock delta so downstream
        # consumers have a reliable contract, not secretly smarter than the rest of mock.
        reflection = Reflection(
            was_best_decision=False,
            suggested_tone_shift="[MOCK] Outreach rejected by human reviewer.",
            suggested_relationship_delta=-1,
        )
        update_client_memory(c_name, reflection, action_taken="rejected_by_reviewer", invoice=invoice)
        return {"status": "skipped", "reason": "rejected by human reviewer"}

    print(f"[MOCK SEND via {draft.channel}] Subject: {draft.subject}")

    # Deterministic mock rule (+2 for successful send).
    # Not real LLM reasoning — just a fixed, predictable mock delta so downstream
    # consumers have a reliable contract, not secretly smarter than the rest of mock.
    reflection = Reflection(
        was_best_decision=True,
        suggested_tone_shift="[MOCK] Outreach dispatched successfully.",
        suggested_relationship_delta=2,
    )

    # Wire persistent client memory: update score and append to interaction history.
    # Seeds initial score from invoice dict if new client.
    update_client_memory(c_name, reflection, action_taken="approved_and_sent", invoice=invoice)

    return {"status": "sent (mock)", "reflection": reflection}
