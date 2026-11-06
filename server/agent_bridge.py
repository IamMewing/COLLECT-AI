#!/usr/bin/env python3
"""Bridge script between Express server and Python Strands Agent.

Accepts JSON via stdin:
{
    "action": "sweep" | "approve",
    "payload": { ... }
}

Outputs JSON via stdout on success. Any errors or stack traces are written to stderr.
"""

import sys
import os
import json
from pathlib import Path

# Force UTF-8 on Windows where piped stdout defaults to cp1252,
# which causes mojibake (e.g. â€™ instead of ') in Gemini-generated text.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")

# Ensure root directory is in sys.path so 'agent' can be imported
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Toggle between mock and real agent runs. Defaults to False (real agent).
# Set USE_MOCK=true or COLLECT_AI_MOCK=true to force mock mode.
USE_MOCK = os.environ.get("USE_MOCK", os.environ.get("COLLECT_AI_MOCK", "false")).lower() in ("true", "1", "yes")

from agent import (
    mock_run_sweep,
    mock_approve_and_execute,
    mock_payment_confirmed,
    mock_handle_incoming_reply,
    run_sweep,
    approve_and_execute,
    record_payment_confirmed,
    handle_incoming_reply,
    process_due_installments,
    check_for_replies,
    DraftedMessage,
)
# handle_incoming_text / mock_handle_incoming_text are imported locally inside
# the bridge function of the same name below (same reasoning as
# handle_installment_paid above it) to avoid the module-level import being
# shadowed by that function's own name.


def to_dict(obj):
    if obj is None:
        return None
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    if isinstance(obj, dict):
        return obj
    return obj


def extract_structured(node_res):
    if not node_res:
        return None
    if hasattr(node_res, "result") and hasattr(node_res.result, "structured_output"):
        return node_res.result.structured_output
    if hasattr(node_res, "structured_output"):
        return node_res.structured_output
    return getattr(node_res, "result", node_res)


def handle_sweep(payload: dict) -> dict:
    invoice = payload.get("invoice")
    if not invoice:
        raise ValueError("Missing 'invoice' in sweep payload")

    # Required fields validation for sweep
    required_keys = ["days_overdue", "amount", "ignored_reminders", "relationship_score", "historical_on_time_rate"]
    missing = [k for k in required_keys if k not in invoice]
    if missing:
        raise ValueError(f"Invoice missing required fields: {', '.join(missing)}")

    # Ensure correct numerical types
    clean_invoice = {
        "invoice_id": str(invoice.get("invoice_id", "INV-UNKNOWN")),
        "client_name": str(invoice.get("client_name", "Valued Client")),
        "amount": float(invoice["amount"]),
        "days_overdue": int(invoice["days_overdue"]),
        "ignored_reminders": int(invoice["ignored_reminders"]),
        "relationship_score": int(invoice["relationship_score"]),
        "historical_on_time_rate": float(invoice["historical_on_time_rate"]),
    }
    # Passed through as-is (no type coercion needed) so the frontend's later
    # /api/agent/approve call — which sends back exactly this "invoice"
    # sub-object from the sweep response — still has the client's real
    # address. Without this, every approve ends up with recipient_email=None
    # even when the invoice was created with one, because the sweep result
    # is the invoice object the frontend has in hand by then.
    if invoice.get("email"):
        clean_invoice["email"] = str(invoice["email"])
    if invoice.get("phone"):
        clean_invoice["phone"] = str(invoice["phone"])

    from agent.memory import get_client_memory, has_client_memory

    if USE_MOCK:
        result = mock_run_sweep(clean_invoice)
    else:
        # For real Strands Agent graph
        c_name = clean_invoice['client_name']
        if has_client_memory(c_name):
            clean_invoice['relationship_score'] = get_client_memory(c_name)['relationship_score']

        task = (
            f"Invoice #{clean_invoice['invoice_id']} for client \"{clean_invoice['client_name']}\"\n"
            f"- Amount: INR {clean_invoice['amount']}\n"
            f"- Days overdue: {clean_invoice['days_overdue']}\n"
            f"- Ignored reminders so far: {clean_invoice['ignored_reminders']}\n"
            f"- Client relationship score: {clean_invoice['relationship_score']} (out of 100)\n"
            f"- Historical on-time payment rate: {clean_invoice['historical_on_time_rate']}\n"
            f"- Email on file: {'yes' if clean_invoice.get('email') else 'no'}\n"
            f"- Phone on file: {'yes' if clean_invoice.get('phone') else 'no'}\n\n"
            f"Assess this invoice's risk, predict payment probability, decide action plan, and draft message if warranted."
        )
        graph_result = run_sweep(task, client_name=clean_invoice['client_name'])
        # Extract structured outputs
        risk = graph_result.results.get("risk_assess")
        prob = graph_result.results.get("probability")
        plan = graph_result.results.get("plan")
        draft = graph_result.results.get("draft")
        result = {
            "risk": extract_structured(risk),
            "probability": extract_structured(prob),
            "plan": extract_structured(plan),
            "draft": extract_structured(draft),
        }

    # If client has persisted memory, reflect the current stored score
    if has_client_memory(clean_invoice["client_name"]):
        clean_invoice["relationship_score"] = get_client_memory(clean_invoice["client_name"])["relationship_score"]

    # Serialize pydantic models to dicts
    serialized = {
        "invoice": clean_invoice,
        "risk": to_dict(result.get("risk")),
        "probability": to_dict(result.get("probability")),
        "plan": to_dict(result.get("plan")),
        "draft": to_dict(result.get("draft")),
        "client_memory": get_client_memory(clean_invoice["client_name"]) if has_client_memory(clean_invoice["client_name"]) else None,
    }
    return serialized


def handle_approve(payload: dict) -> dict:
    from agent.memory import get_client_memory, extract_client_name_from_draft, has_client_memory

    draft_data = payload.get("draft")
    approved = bool(payload.get("approved", False))
    edited_body = payload.get("edited_body")
    client_name = payload.get("client_name")

    if not draft_data:
        raise ValueError("Missing 'draft' in approve payload")

    # If body was edited, override it
    if edited_body:
        draft_data["body"] = edited_body

    draft = DraftedMessage(
        subject=draft_data["subject"],
        body=draft_data["body"],
        channel=draft_data.get("channel", "email"),
    )

    c_name = client_name or extract_client_name_from_draft(draft)
    invoice = payload.get("invoice")

    if USE_MOCK:
        outcome = mock_approve_and_execute(draft=draft, approved=approved, client_name=c_name, invoice=invoice)
    else:
        outcome = approve_and_execute(message=draft, approved=approved, edited_body=edited_body, client_name=c_name, invoice=invoice)

    # Serialize outcome
    serialized_outcome = {
        "status": outcome.get("status"),
        "reason": outcome.get("reason"),
        "channel": draft.channel,
        "subject": draft.subject,
        "final_body": draft.body,
        "client_memory": get_client_memory(c_name) if has_client_memory(c_name) else None,
    }

    if "reflection" in outcome and outcome["reflection"]:
        reflection = outcome["reflection"]
        serialized_outcome["reflection"] = to_dict(reflection)

    if "send_result" in outcome:
        serialized_outcome["send_result"] = outcome["send_result"]

    return serialized_outcome


def handle_payment_confirmed(payload: dict) -> dict:
    """Triggered by a PayPal webhook (INVOICING.INVOICE.PAID) relayed from Express.

    This is the closed loop: a real payment event — not a human clicking
    'mark paid' — runs the agent's reflection and updates persistent client
    memory. Deliberately model-agnostic at the dispatch layer: mock mode uses
    a deterministic positive reflection, real mode tries an LLM reflection
    with its own internal fallback (see agent/execute.py).
    """
    from agent.memory import get_client_memory, has_client_memory

    client_name = payload.get("client_name")
    invoice = payload.get("invoice")
    days_overdue = invoice.get("days_overdue") if isinstance(invoice, dict) else None

    if USE_MOCK:
        outcome = mock_payment_confirmed(client_name, invoice=invoice)
    else:
        outcome = record_payment_confirmed(client_name, invoice=invoice, days_overdue=days_overdue)

    return {
        "status": outcome.get("status"),
        "reflection": to_dict(outcome.get("reflection")),
        "client_memory": get_client_memory(client_name) if client_name and has_client_memory(client_name) else outcome.get("client_memory"),
    }


def handle_check_replies(payload: dict) -> dict:
    """Polls the inbox for client replies (agent/inbox.py) and runs each one
    through the autonomous negotiation loop (agent/execute.py's
    handle_incoming_reply, or its mock counterpart), then — real mode only —
    also bills any payment-plan installment that's come due
    (process_due_installments). One scheduled call does both jobs; see
    server.js's /api/agent/check-replies, triggered by Cloud Scheduler.
    Payment plans are a real-mode-only feature (mock mode never sends real
    email, so there's no real client who could agree to one in the first
    place — see agent/mock.py's module docstring for the same reasoning
    applied to the rest of mock mode).
    """
    replies = check_for_replies()
    results = []
    for reply in replies:
        try:
            if USE_MOCK:
                outcome = mock_handle_incoming_reply(reply)
            else:
                outcome = handle_incoming_reply(reply)
        except Exception as exc:  # noqa: BLE001 - one bad reply must not stop the rest of the batch
            outcome = {"status": "error", "reason": str(exc)}
        results.append({
            "invoice_id": reply.get("invoice_id"),
            "from_email": reply.get("from_email"),
            **outcome,
        })

    billed_installments = [] if USE_MOCK else process_due_installments()

    return {"checked": len(replies), "results": results, "billed_installments": billed_installments}


def handle_installment_paid(payload: dict) -> dict:
    """Triggered by server.js's PayPal webhook handler when it captures an
    order tagged 'plan_installment' (see agent/tools/paypal_tools.py) —
    marks that one installment paid without closing out the rest of the
    invoice's plan."""
    invoice_id = payload.get("invoice_id")
    installment_index = payload.get("installment_index")
    paypal_order_id = payload.get("paypal_order_id")
    if invoice_id is None or installment_index is None:
        raise ValueError("Missing 'invoice_id' or 'installment_index' in installment_paid payload")

    from agent import handle_installment_paid as _handle_installment_paid

    outcome = _handle_installment_paid(invoice_id, int(installment_index), paypal_order_id)
    return {
        "status": outcome.get("status"),
        "reflection": to_dict(outcome.get("reflection")),
        "plan": outcome.get("plan"),
    }


def handle_incoming_text(payload: dict) -> dict:
    """Triggered by server.js's Twilio webhook handler (POST
    /api/twilio/webhook) for every inbound WhatsApp/SMS message — the
    text-message equivalent of handle_check_replies' email polling, except
    pushed to us by Twilio rather than pulled on a schedule. Resolves which
    invoice the text belongs to and runs it through the same
    negotiation-loop logic email replies use (see agent/execute.py's
    handle_incoming_text / agent/mock.py's mock_handle_incoming_text)."""
    from_phone = payload.get("from_phone")
    body = payload.get("body", "")
    channel = payload.get("channel", "sms")
    if not from_phone:
        raise ValueError("Missing 'from_phone' in incoming_text payload")

    if USE_MOCK:
        from agent import mock_handle_incoming_text as _handle_incoming_text
    else:
        from agent import handle_incoming_text as _handle_incoming_text

    return _handle_incoming_text(from_phone, body, channel)


def handle_voice_turn(payload: dict) -> dict:
    """Triggered by BOTH of server.js's Twilio Voice webhooks — POST
    /api/twilio/voice (the call just connected; transcript is None) and
    POST /api/twilio/voice/gather (Twilio's speech-to-text of what the
    client just said; transcript is that text, possibly ''). Decides what
    the agent should say next and whether to keep listening or hang up —
    see agent/execute.py's handle_voice_turn / agent/mock.py's
    mock_handle_voice_turn. 'invoice' is the same clean invoice dict shape
    handle_sweep builds (server.js looks it up from the store by invoice_id
    on every voice webhook call, since Twilio's own payload only carries
    the invoice_id query param, not invoice data)."""
    invoice_id = payload.get("invoice_id")
    transcript = payload.get("transcript")
    invoice = payload.get("invoice")
    if not invoice_id:
        raise ValueError("Missing 'invoice_id' in voice_turn payload")

    # Same local-aliased-import reasoning as handle_incoming_text above:
    # this bridge function shares its name with the agent package's
    # top-level export, so the import is aliased to avoid shadowing it.
    if USE_MOCK:
        from agent import mock_handle_voice_turn as _handle_voice_turn
    else:
        from agent import handle_voice_turn as _handle_voice_turn

    return _handle_voice_turn(invoice_id, transcript, invoice)


def handle_negotiation_state(payload: dict) -> dict:
    """Read-only snapshot for the UI's negotiation panel: every tracked
    conversation thread and payment plan, regardless of status. Unlike
    check_replies/installment_paid, this never changes anything — it's what
    GET /api/agent/negotiations calls on every page load/refresh."""
    from agent.memory import list_all_conversations, list_all_payment_plans

    return {
        "conversations": list_all_conversations(),
        "payment_plans": list_all_payment_plans(),
    }


def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValueError("No input received on stdin")

        request = json.loads(raw_input)
        action = request.get("action")
        payload = request.get("payload", {})

        # Redirect stdout during mock/agent calls so any print() statements (like "[MOCK SEND...]")
        # go to stderr/logs and don't corrupt stdout JSON.
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            if action == "sweep":
                res = handle_sweep(payload)
            elif action == "approve":
                res = handle_approve(payload)
            elif action == "payment_confirmed":
                res = handle_payment_confirmed(payload)
            elif action == "check_replies":
                res = handle_check_replies(payload)
            elif action == "installment_paid":
                res = handle_installment_paid(payload)
            elif action == "incoming_text":
                res = handle_incoming_text(payload)
            elif action == "voice_turn":
                res = handle_voice_turn(payload)
            elif action == "negotiation_state":
                res = handle_negotiation_state(payload)
            else:
                raise ValueError(
                    f"Unknown action '{action}'. Valid actions are 'sweep', 'approve', "
                    "'payment_confirmed', 'check_replies', 'installment_paid', "
                    "'incoming_text', 'voice_turn', and 'negotiation_state'."
                )

        json.dump(res, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        # Write exact error message and traceback to stderr so Express can capture it
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
