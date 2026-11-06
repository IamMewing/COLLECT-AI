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
from .models import RiskAssessment, ProbabilityAssessment, ActionPlan, DraftedMessage, Reflection, NegotiationTurn
from .memory import (
    get_client_memory,
    update_client_memory,
    has_client_memory,
    remember_invoice_score,
    extract_client_name_from_draft,
    record_message_history,
    get_conversation,
    start_conversation,
    append_conversation_turn,
    set_conversation_status,
    find_active_conversation_by_phone,
)
from .inbox import INVOICE_TAG_RE


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
    # keep these two in sync if you tune the real prompt. Channel choice
    # respects the same hard constraint the real prompt is told about: never
    # pick whatsapp/sms without a phone actually on file.
    has_email = bool(invoice.get("email"))
    has_phone = bool(invoice.get("phone"))
    standard_channel = "email" if has_email else ("sms" if has_phone else "email")
    escalation_channel = "whatsapp" if has_phone else "email"

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
            channel=standard_channel,
            tone="friendly",
            reasoning=f"[MOCK] Low/Medium risk with reasonable payment probability. "
                      f"Channel={standard_channel} (email on file: {has_email}, phone on file: {has_phone}).",
        )
    else:
        plan = ActionPlan(
            branch="escalation",
            channel=escalation_channel,
            tone="firm",
            reasoning=f"[MOCK] High/Critical risk or low payment probability. "
                      f"Channel={escalation_channel} (email on file: {has_email}, phone on file: {has_phone}).",
        )

    draft = None
    if plan.branch != "no_action":
        client = invoice.get("client_name", "there")
        channel = plan.channel if plan.channel in ("email", "whatsapp", "sms") else "email"
        tone_opener = {
            "friendly": f"Hope you're doing well, {client}!",
            "firm": f"Hi {client}, following up on an overdue balance.",
            "urgent": f"Hi {client} — this needs prompt attention.",
        }.get(plan.tone, f"Hi {client},")
        closer = {
            "friendly": "No rush if it's already on its way — just flagging it.",
            "firm": "Could you confirm when this will be settled?",
            "urgent": "Please treat this as time-sensitive and confirm today.",
        }.get(plan.tone, "Let me know where this stands.")

        if channel == "sms":
            # Mirrors the real draft agent's sms rule: terse, no sign-off,
            # link inline rather than on its own block of lines.
            body = (
                f"Invoice {invoice.get('invoice_id', 'N/A')} for INR {invoice['amount']:,.0f} "
                f"is {invoice['days_overdue']} days past due. {closer} Pay here: {{{{PAYMENT_LINK}}}}"
            )
        else:
            body = (
                f"{tone_opener}\n\n"
                f"Invoice {invoice.get('invoice_id', 'N/A')} for INR "
                f"{invoice['amount']:,.0f} is {invoice['days_overdue']} days past due. "
                f"{closer}\n\n"
                f"You can settle it here:\n"
                f"{{{{PAYMENT_LINK}}}}\n\n"
                f"(Offline mode: this draft is templated rather than model-written. "
                f"Set USE_MOCK=false to have the agent write it.)"
            )

        draft = DraftedMessage(
            subject=f"Invoice {invoice.get('invoice_id', 'N/A')} — outstanding balance",
            body=body,
            channel=channel,
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
    recipient_email = (invoice or {}).get("email") if isinstance(invoice, dict) else None
    recipient_phone = (invoice or {}).get("phone") if isinstance(invoice, dict) else None
    invoice_id = (invoice or {}).get("invoice_id") if isinstance(invoice, dict) else None

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
        record_message_history({
            "invoice_id": invoice_id,
            "client_name": c_name,
            "channel": draft.channel,
            "subject": draft.subject,
            "body": draft.body,
            "recipient_email": recipient_email,
            "recipient": recipient_email or recipient_phone,
            "status": "rejected",
            "real_send": False,
        })
        return {"status": "skipped", "reason": "rejected by human reviewer"}

    mock_recipient = recipient_email if draft.channel == "email" else recipient_phone
    print(f"[MOCK SEND via {draft.channel}] Subject: {draft.subject}" + (f" to {mock_recipient}" if mock_recipient else ""))

    # No real email/text ever goes out in mock mode (that's the whole point —
    # zero cost, zero network calls), so there's no real client who could
    # reply. Still open/track the conversation thread exactly like the real
    # path does, so the negotiation loop's data flow and the Approval Gate UI
    # can be fully exercised in mock mode by manually feeding it a crafted
    # reply (see tests/test_negotiation.py) before ever flipping to real
    # sending.
    if invoice_id and draft.channel in ("email", "whatsapp", "sms"):
        start_conversation(invoice_id, client_name=c_name, recipient_email=recipient_email, recipient_phone=recipient_phone)
        append_conversation_turn(
            invoice_id, role="agent", body=draft.body,
            subject=draft.subject if draft.channel == "email" else None,
            channel=draft.channel,
        )

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

    record_message_history({
        "invoice_id": invoice_id,
        "client_name": c_name,
        "channel": draft.channel,
        "subject": draft.subject if draft.channel == "email" else None,
        "body": draft.body,
        "recipient_email": recipient_email if draft.channel == "email" else None,
        "recipient": mock_recipient,
        "status": "sent (mock)",
        "real_send": False,
    })

    return {"status": "sent (mock)", "reflection": reflection}


def mock_payment_confirmed(client_name: str | None, invoice: dict | None = None) -> dict:
    """Mock version of execute.record_payment_confirmed — deterministic, no LLM call.

    Mirrors what the real PayPal-webhook-triggered reflection does: a positive,
    fixed relationship-score bump and an interaction-history entry, so the
    closed-loop demo works identically whether MODEL_PROVIDER is configured or not.
    """
    c_name = client_name or "Unknown Client"
    reflection = Reflection(
        was_best_decision=True,
        suggested_tone_shift="[MOCK] Client paid in full via PayPal — outreach approach validated.",
        suggested_relationship_delta=5,
    )
    record = update_client_memory(c_name, reflection, action_taken="payment_received_via_paypal", invoice=invoice)
    return {"status": "closed", "reflection": reflection, "client_memory": record}


# Deterministic keyword buckets for mock_handle_incoming_reply — not real
# language understanding, just enough signal to exercise all three outcome
# branches without any model call, the same trade-off mock_run_sweep makes
# for the risk/probability/plan pipeline.
_RESOLVED_KEYWORDS = ("paid", "already sent", "just sent", "payment sent", "done", "settled")
_ESCALATE_KEYWORDS = ("lawyer", "attorney", "unacceptable", "refuse", "dispute", "never received", "scam", "fraud")


def mock_handle_incoming_reply(reply: dict) -> dict:
    """Mock version of execute.handle_incoming_reply — no LLM call. Classifies
    the reply by simple keyword matching so the negotiation loop's three
    outcome branches (resolved / escalate_to_human / continue_negotiating)
    are all reachable and demoable with USE_MOCK=true. `reply` may be
    {invoice_id, body, subject, from_email} (email) or {invoice_id, body,
    channel, from_phone} (WhatsApp/SMS, via mock_handle_incoming_text)."""
    invoice_id = reply.get("invoice_id")
    if not invoice_id:
        return {"status": "skipped", "reason": "no invoice tag found in subject"}

    channel = reply.get("channel", "email")

    convo = get_conversation(invoice_id)
    if convo is None:
        return {"status": "skipped", "reason": "no tracked conversation for this invoice"}
    if convo.get("status") != "active":
        return {"status": "skipped", "reason": f"conversation status is '{convo.get('status')}', not active"}

    body = reply.get("body", "")
    append_conversation_turn(invoice_id, role="client", body=body, subject=reply.get("subject"), channel=channel)

    lowered = body.lower()
    client_name = convo.get("client_name")

    if any(kw in lowered for kw in _RESOLVED_KEYWORDS):
        set_conversation_status(invoice_id, "resolved")
        return {"status": "resolved", "reasoning": "[MOCK] Reply indicates payment was already made."}

    if any(kw in lowered for kw in _ESCALATE_KEYWORDS):
        set_conversation_status(invoice_id, "escalated")
        return {"status": "escalate_to_human", "reasoning": "[MOCK] Reply contains a dispute/escalation keyword."}

    if channel == "email":
        reply_subject = f"Re: Invoice {invoice_id} follow-up [{invoice_id}]"
        reply_body = (
            f"Hi {client_name or 'there'},\n\n"
            "Thanks for getting back to us. If a part-payment or a short installment "
            "plan would help, let us know an amount and timeline that works and we'll "
            "set it up.\n\n"
            "The Accounts Team\n\n"
            "(Offline mode: this reply is templated rather than model-written. Set "
            "USE_MOCK=false to have the agent negotiate for real.)"
        )
    else:
        reply_subject = None
        reply_body = (
            f"Thanks for the reply, {client_name or 'there'}. If a part-payment or short "
            "plan would help, tell us an amount/timeline and we'll set it up. "
            "(Offline mode — set USE_MOCK=false for a real negotiated reply.)"
        )
    append_conversation_turn(invoice_id, role="agent", body=reply_body, subject=reply_subject, channel=channel)

    recipient_email = convo.get("recipient_email")
    recipient_phone = convo.get("recipient_phone")
    record_message_history({
        "invoice_id": invoice_id,
        "client_name": client_name,
        "channel": channel,
        "subject": reply_subject,
        "body": reply_body,
        "recipient_email": recipient_email if channel == "email" else None,
        "recipient": recipient_email or recipient_phone,
        "status": "drafted (pending review)",
        "real_send": False,
        "autonomous_reply": True,
    })

    return {
        "status": "continue_negotiating",
        "reasoning": "[MOCK] No resolve/escalate keyword matched — proposing a templated plan.",
        "pending_human_review": True,
    }


def mock_handle_incoming_text(from_phone: str, body: str, channel: str = "sms") -> dict:
    """Mock version of execute.handle_incoming_text — resolves which invoice
    an inbound WhatsApp/SMS belongs to (by [INV-XXXX] tag in the body, or by
    phone-number lookup against tracked conversations) with zero LLM/network
    calls, then hands off to mock_handle_incoming_reply above."""
    tag_match = INVOICE_TAG_RE.search(body)
    invoice_id = tag_match.group(1) if tag_match else find_active_conversation_by_phone(from_phone)

    if not invoice_id:
        return {"status": "skipped", "reason": "no matching conversation for this phone number", "from_phone": from_phone}

    return mock_handle_incoming_reply({
        "invoice_id": invoice_id, "body": body, "channel": channel,
        "subject": None, "from_phone": from_phone,
    })
