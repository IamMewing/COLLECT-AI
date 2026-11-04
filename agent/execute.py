"""Phase 2: approve -> execute -> reflect.

This runs *after* graph.run_sweep() returns a DraftedMessage and a
human has approved it. It's deliberately not part of the Graph itself
— the approval step needs a human in the loop (your Approval Gate UI
panel calls this), and there's no reason to force that through the
graph's execution model when a plain function does the job clearly.
"""

import os
import smtplib
from email.mime.text import MIMEText

from .agents import build_reflect_agent
from .models import DraftedMessage, Reflection
from .memory import update_client_memory, extract_client_name_from_draft, record_message_history


def send_message(message: DraftedMessage, recipient_email: str | None = None) -> dict:
    """Sends the drafted message for real if SEND_REAL_EMAIL=true and SMTP
    env vars are configured; otherwise falls back to the original
    print-only stub. This fallback is deliberate — if credentials are
    missing or misconfigured, the demo keeps working instead of crashing
    the approve flow.

    Recipient priority: `recipient_email` (the invoice's own email, passed
    in by approve_and_execute below) if set, otherwise DEMO_RECIPIENT_EMAIL
    as a fallback — the curated sample invoices have no real client contact,
    so there's nothing truthful to send "real" mail to for those; routing
    them to your own inbox still proves the SMTP wiring works.

    Required env vars for real sending (channel == "email" only):
        SEND_REAL_EMAIL=true
        SMTP_HOST      (default: smtp.gmail.com)
        SMTP_PORT      (default: 587)
        SMTP_USER      (the sending account, e.g. your Gmail address)
        SMTP_PASS      (an App Password — NOT your regular account password)
        DEMO_RECIPIENT_EMAIL  (fallback recipient when an invoice has no
                               email of its own — use your own inbox)

    WhatsApp is not wired to a real API — it still just logs.
    """
    real_send_requested = os.environ.get("SEND_REAL_EMAIL", "false").lower() == "true"

    if real_send_requested and message.channel == "email":
        smtp_user = os.environ.get("SMTP_USER")
        smtp_pass = os.environ.get("SMTP_PASS")
        recipient = recipient_email or os.environ.get("DEMO_RECIPIENT_EMAIL")

        if not (smtp_user and smtp_pass and recipient):
            print(
                "[SEND via email] SEND_REAL_EMAIL=true but SMTP_USER / SMTP_PASS / "
                "a recipient (invoice email or DEMO_RECIPIENT_EMAIL) are not all set — "
                "falling back to stub.",
                flush=True,
            )
        else:
            try:
                host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
                port = int(os.environ.get("SMTP_PORT", "587"))

                mime_msg = MIMEText(message.body)
                mime_msg["Subject"] = f"[CollectAI demo] {message.subject}"
                mime_msg["From"] = smtp_user
                mime_msg["To"] = recipient

                with smtplib.SMTP(host, port, timeout=15) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.sendmail(smtp_user, [recipient], mime_msg.as_string())

                print(f"[SEND via email] Real email sent to {recipient}. Subject: {message.subject}", flush=True)
                return {"status": "sent", "channel": message.channel, "real_send": True, "recipient": recipient}
            except Exception as exc:  # noqa: BLE001 - deliberately broad: never let a send failure break approval
                print(f"[SEND via email] Real send FAILED ({exc}) — falling back to stub.", flush=True)

    # Stub path (default, or fallback on missing config / send failure)
    print(f"[SEND via {message.channel}] Subject: {message.subject}")
    print(message.body)
    return {"status": "sent", "channel": message.channel, "real_send": False, "recipient": recipient_email}


def approve_and_execute(
    message: DraftedMessage,
    approved: bool,
    edited_body: str | None = None,
    client_name: str | None = None,
    invoice: dict | None = None,
    initial_score: int | None = None,
) -> dict:
    """Called by the Approval Gate UI when the human clicks Approve/Reject.

    Args:
        message: The DraftedMessage from graph.run_sweep().
        approved: True if the human clicked Approve.
        edited_body: If the human edited the draft before approving,
            pass the edited text here — it overrides message.body.
        client_name: Optional name of the client to update memory for.
        invoice: Optional invoice dict to seed relationship_score if new client.
        initial_score: Optional explicit score to seed if new client.

    Returns:
        dict with the execution result and the reflection, or a
        'skipped' status if the human rejected the draft.
    """
    c_name = client_name or extract_client_name_from_draft(message)
    recipient_email = (invoice or {}).get("email") or None
    invoice_id = (invoice or {}).get("invoice_id")

    if not approved:
        reflection = Reflection(
            was_best_decision=False,
            suggested_tone_shift="Message rejected by human reviewer.",
            suggested_relationship_delta=-1,
        )
        update_client_memory(
            c_name,
            reflection,
            action_taken="rejected_by_reviewer",
            invoice=invoice,
            initial_score=initial_score,
        )
        record_message_history({
            "invoice_id": invoice_id,
            "client_name": c_name,
            "channel": message.channel,
            "subject": message.subject,
            "body": message.body,
            "recipient_email": recipient_email,
            "status": "rejected",
            "real_send": False,
        })
        return {"status": "skipped", "reason": "rejected by human reviewer"}

    if edited_body:
        message = message.model_copy(update={"body": edited_body})

    send_result = send_message(message, recipient_email=recipient_email)

    reflect_agent = build_reflect_agent()
    reflect_result = reflect_agent(
        f"A collections message was just sent.\n"
        f"Channel: {message.channel}\nSubject: {message.subject}\nBody: {message.body}\n"
        f"Send result: {send_result}\n"
        f"(No client response yet — reflect on the decision to send this, its tone, "
        f"and whether the approach fits the situation.)"
    )
    reflection: Reflection = reflect_result.structured_output

    # Wire persistent client memory
    update_client_memory(
        c_name,
        reflection,
        action_taken="approved_and_sent",
        invoice=invoice,
        initial_score=initial_score,
    )

    record_message_history({
        "invoice_id": invoice_id,
        "client_name": c_name,
        "channel": message.channel,
        "subject": message.subject,
        "body": message.body,
        "recipient_email": send_result.get("recipient"),
        "status": send_result.get("status"),
        "real_send": send_result.get("real_send", False),
    })

    return {"status": "sent", "send_result": send_result, "reflection": reflection}


def record_payment_confirmed(
    client_name: str | None,
    invoice: dict | None = None,
    days_overdue: int | None = None,
) -> dict:
    """Called when a PayPal webhook reports INVOICING.INVOICE.PAID — this is the
    closed loop: a real payment event, not a human clicking a button, triggers
    the agent's reflection and updates persistent client memory.

    Tries a genuine LLM reflection first (the agent reasons about the fact that
    its own outreach led to a real payment); falls back to a deterministic
    positive Reflection if the model call fails for any reason (missing API
    key/credits, network hiccup) so a webhook firing mid-demo never 500s.
    """
    c_name = client_name or "Unknown Client"
    context = (
        f"A collections outreach was sent for client \"{c_name}\""
        + (f", invoice overdue by {days_overdue} days" if days_overdue is not None else "")
        + ". PayPal has just confirmed the invoice was paid IN FULL via a real "
        "payment event (not a manual override). Reflect on this outcome: was "
        "the earlier approach effective, and how should this shape future tone "
        "and the client's relationship score (this should be a clearly positive "
        "delta — the agent's handling worked)."
    )

    try:
        reflect_agent = build_reflect_agent()
        reflect_result = reflect_agent(context)
        reflection: Reflection = reflect_result.structured_output
    except Exception as exc:  # noqa: BLE001 - never let a webhook handler 500 the demo
        print(f"[PAYMENT_CONFIRMED] LLM reflection failed ({exc}) — using deterministic fallback.", flush=True)
        reflection = Reflection(
            was_best_decision=True,
            suggested_tone_shift="Client paid in full via PayPal — outreach approach validated.",
            suggested_relationship_delta=5,
        )

    record = update_client_memory(
        c_name,
        reflection,
        action_taken="payment_received_via_paypal",
        invoice=invoice,
    )

    return {"status": "closed", "reflection": reflection, "client_memory": record}

