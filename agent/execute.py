"""Phase 2: approve -> execute -> reflect.

This runs *after* graph.run_sweep() returns a DraftedMessage and a
human has approved it. It's deliberately not part of the Graph itself
— the approval step needs a human in the loop (your Approval Gate UI
panel calls this), and there's no reason to force that through the
graph's execution model when a plain function does the job clearly.
"""

import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from .agents import build_reflect_agent, build_negotiate_agent
from .models import DraftedMessage, Reflection, NegotiationTurn
from .memory import (
    update_client_memory,
    extract_client_name_from_draft,
    record_message_history,
    get_conversation,
    start_conversation,
    append_conversation_turn,
    set_conversation_status,
    create_payment_plan,
    update_installment,
    list_active_payment_plans,
    find_active_conversation_by_phone,
)
from .tools.paypal_tools import create_paypal_order, save_installment_order_mapping
from .tools.sms_tools import send_text_message
from .inbox import INVOICE_TAG_RE


def _tag_subject(subject: str, invoice_id: str | None) -> str:
    """Every outbound email's subject carries an '[INV-XXXX]' tag so a
    client's reply (which almost always preserves the subject, prefixed
    with 'Re:') can be matched back to the right conversation by
    agent/inbox.py without relying on header threading. Idempotent — if the
    tag is already present (e.g. a negotiation reply whose subject the
    negotiate agent wrote itself), it isn't duplicated."""
    if not invoice_id:
        return f"[CollectAI demo] {subject}"
    tag = f"[{invoice_id}]"
    if tag in subject:
        return f"[CollectAI] {subject}"
    return f"[CollectAI] [{invoice_id}] {subject}"


def _tag_body(body: str, invoice_id: str | None) -> str:
    """The WhatsApp/SMS equivalent of _tag_subject: there's no subject line
    on those channels, so the same '[INV-XXXX]' tag (INVOICE_TAG_RE, shared
    with the email inbox poller) goes on its own short line at the end of
    the body instead. This is a secondary matching path — the primary one
    for inbound texts is find_active_conversation_by_phone(), since most
    clients will just reply without echoing any of the original text — but
    it costs one line and means a quoted/forwarded reply still matches."""
    if not invoice_id:
        return body
    tag = f"[{invoice_id}]"
    if tag in body:
        return body
    return f"{body}\n\n(Ref: {tag})"


def send_message(
    message: DraftedMessage,
    recipient_email: str | None = None,
    recipient_phone: str | None = None,
    invoice_id: str | None = None,
    opens_session: bool = False,
) -> dict:
    """Sends the drafted message for real if configured; otherwise falls
    back to a print-only stub. This fallback is deliberate — if credentials
    are missing or misconfigured, the demo keeps working instead of
    crashing the approve flow.

    Email (channel == "email"): required env vars for real sending:
        SEND_REAL_EMAIL=true
        SMTP_HOST      (default: smtp.gmail.com)
        SMTP_PORT      (default: 587)
        SMTP_USER      (the sending account, e.g. your Gmail address)
        SMTP_PASS      (an App Password — NOT your regular account password)
        DEMO_RECIPIENT_EMAIL  (fallback recipient when an invoice has no
                               email of its own — use your own inbox)
    `invoice_id`, when given, gets woven into the subject as an "[INV-XXXX]"
    tag (see _tag_subject) — this is what lets agent/inbox.py's reply poller
    match an incoming reply back to this invoice's conversation thread.

    WhatsApp/SMS (channel in ("whatsapp", "sms")): sent via
    agent/tools/sms_tools.py if TWILIO_ACCOUNT_SID/AUTH_TOKEN are configured
    and `recipient_phone` is given; otherwise falls back to the print stub.
    `opens_session` should be True only when this message is a reply to one
    the client just sent on WhatsApp/SMS (that inbound message is what opens
    WhatsApp's 24h free-form window) — see sms_tools.send_text_message's
    docstring for why this matters and what happens when it's False.
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
                mime_msg["Subject"] = _tag_subject(message.subject, invoice_id)
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

    if message.channel in ("whatsapp", "sms"):
        if recipient_phone:
            result = send_text_message(
                recipient_phone, _tag_body(message.body, invoice_id), opens_session=opens_session
            )
            return {
                "status": result["status"],
                "channel": message.channel,
                "channel_used": result["channel_used"],
                "real_send": result["real_send"],
                "recipient": result["recipient"],
                "message_sid": result.get("message_sid"),
            }
        print(f"[SEND via {message.channel}] No phone on file for this invoice — falling back to stub.", flush=True)

    # Stub path (default, or fallback on missing config / send failure / no phone on file)
    print(f"[SEND via {message.channel}] Subject: {message.subject}")
    print(message.body)
    return {"status": "sent", "channel": message.channel, "real_send": False, "recipient": recipient_email or recipient_phone}


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
    recipient_phone = (invoice or {}).get("phone") or None
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
            "recipient": recipient_email or recipient_phone,
            "status": "rejected",
            "real_send": False,
        })
        return {"status": "skipped", "reason": "rejected by human reviewer"}

    if edited_body:
        message = message.model_copy(update={"body": edited_body})

    # First-ever outreach on an invoice is always business-initiated, never a
    # reply to something the client just sent — so opens_session is always
    # False here. For channel='whatsapp' that means send_message/sms_tools
    # will actually send it as SMS instead (see sms_tools.send_text_message's
    # docstring): a free-form WhatsApp message here would need a pre-approved
    # template, which isn't something this demo has set up.
    send_result = send_message(
        message, recipient_email=recipient_email, recipient_phone=recipient_phone,
        invoice_id=invoice_id, opens_session=False,
    )

    # Open (or reactivate) this invoice's conversation thread so a reply the
    # client sends later can be picked up by the negotiation loop — see
    # agent/inbox.py (email) / the 'incoming_text' bridge action (WhatsApp/SMS)
    # and handle_incoming_reply below.
    if invoice_id and message.channel in ("email", "whatsapp", "sms"):
        start_conversation(invoice_id, client_name=c_name, recipient_email=recipient_email, recipient_phone=recipient_phone)
        append_conversation_turn(
            invoice_id, role="agent", body=message.body,
            subject=message.subject if message.channel == "email" else None,
            channel=message.channel,
        )

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
        "recipient_email": send_result.get("recipient") if message.channel == "email" else None,
        "recipient": send_result.get("recipient"),
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


def handle_incoming_reply(reply: dict) -> dict:
    """The autonomous negotiation loop's entry point. Called once per reply
    found by agent/inbox.py's check_for_replies() (via the 'check_replies'
    bridge action), or per text routed by handle_incoming_text() below
    (via the 'incoming_text' bridge action — Twilio's WhatsApp/SMS webhook).
    `reply` is {invoice_id, body, channel, subject, from_email, from_phone}
    — subject/from_email are email-specific and None for a text; from_phone
    is text-specific and None for an email.

    This is deliberately NOT gated behind a human approval by default: the
    whole point is an agent that reads what the client actually wrote and
    decides what to do next on its own. Set AUTO_APPROVE_NEGOTIATION=true to
    let it send its own follow-up replies unattended; left unset (the safe
    default), it still does all the reading and deciding itself, but queues
    the reply it would have sent rather than dispatching it — visible in the
    conversation record and the History panel as a pending autonomous turn.
    """
    invoice_id = reply.get("invoice_id")
    if not invoice_id:
        return {"status": "skipped", "reason": "no invoice tag found in subject"}

    channel = reply.get("channel", "email")

    convo = get_conversation(invoice_id)
    if convo is None:
        print(
            f"[NEGOTIATE] Reply tagged {invoice_id} from "
            f"{reply.get('from_email') or reply.get('from_phone')} but no tracked "
            "conversation exists for it — skipping.",
            flush=True,
        )
        return {"status": "skipped", "reason": "no tracked conversation for this invoice"}

    if convo.get("status") != "active":
        return {"status": "skipped", "reason": f"conversation status is '{convo.get('status')}', not active"}

    append_conversation_turn(
        invoice_id, role="client", body=reply.get("body", ""), subject=reply.get("subject"), channel=channel
    )
    convo = get_conversation(invoice_id)  # re-read so the thread below includes the turn just appended

    client_name = convo.get("client_name")
    thread_text = "\n\n".join(
        f"[{turn.get('role', '?').upper()} via {turn.get('channel', 'email')}]"
        + (f" Subject: {turn.get('subject')}" if turn.get("subject") else "")
        + f"\n{turn.get('body', '')}"
        for turn in convo.get("turns", [])
    )

    negotiate_agent = build_negotiate_agent()
    context = (
        f"Invoice {invoice_id}, client \"{client_name}\".\n\n"
        f"Full thread so far (oldest first):\n\n{thread_text}\n\n"
        "Decide the outcome for this latest client message, per your instructions."
    )

    try:
        result = negotiate_agent(context)
        decision: NegotiationTurn = result.structured_output
    except Exception as exc:  # noqa: BLE001 - a flaky model call must never crash the whole reply-check sweep
        print(f"[NEGOTIATE] LLM call failed for {invoice_id} ({exc}) — escalating to a human instead of guessing.", flush=True)
        set_conversation_status(invoice_id, "escalated")
        return {"status": "escalate_to_human", "reason": f"negotiation agent call failed: {exc}"}

    outcome: dict = {
        "status": decision.outcome,
        "reasoning": decision.reasoning,
        "proposed_plan": decision.proposed_plan,
    }

    if decision.outcome == "resolved":
        set_conversation_status(invoice_id, "resolved")
        return outcome

    if decision.outcome == "escalate_to_human":
        set_conversation_status(invoice_id, "escalated")
        return outcome

    # continue_negotiating — reply on the SAME channel the client just used.
    reply_subject = (decision.reply_subject or f"Re: Invoice {invoice_id} [{invoice_id}]") if channel == "email" else None
    reply_body = decision.reply_body or ""
    append_conversation_turn(invoice_id, role="agent", body=reply_body, subject=reply_subject, channel=channel)

    # A concrete multi-installment plan the client just agreed to: persist it
    # so later installments get auto-billed as they come due (see
    # process_due_installments below). If the agent already minted installment
    # 0's order this turn (decision.paypal_order_id set), record it as
    # awaiting payment and re-tag the mapping as a plan installment rather
    # than the generic full-invoice default create_paypal_order wrote — a
    # client paying installment 1 of 3 should not close the whole invoice.
    if decision.installments and len(decision.installments) >= 2:
        now = datetime.now(timezone.utc)
        installment_records = []
        for i, inst in enumerate(decision.installments):
            is_first_and_billed = i == 0 and decision.paypal_order_id
            installment_records.append({
                "index": i,
                "amount_usd": inst.amount_usd,
                "description": inst.description,
                "due_at": (now + timedelta(days=inst.due_in_days)).isoformat(),
                "status": "awaiting_payment" if is_first_and_billed else "scheduled",
                "paypal_order_id": decision.paypal_order_id if is_first_and_billed else None,
                "payment_link": decision.payment_link if is_first_and_billed else None,
            })
        create_payment_plan(invoice_id, client_name=client_name, installments=installment_records)
        if decision.paypal_order_id:
            save_installment_order_mapping(decision.paypal_order_id, invoice_id=invoice_id, client_name=client_name, installment_index=0)
        outcome["payment_plan_created"] = True

    auto_send = os.environ.get("AUTO_APPROVE_NEGOTIATION", "false").lower() == "true"
    recipient_email = convo.get("recipient_email")
    recipient_phone = convo.get("recipient_phone")

    if auto_send and reply_body:
        draft = DraftedMessage(subject=reply_subject or f"Re: {invoice_id}", body=reply_body, channel=channel)
        # opens_session=True: this reply is going out BECAUSE the client just
        # messaged on this same channel — for whatsapp that's exactly the
        # event that opens the 24h free-form window, so a genuine WhatsApp
        # body reply (not a downgrade to SMS) is appropriate here, unlike the
        # very first, business-initiated message in approve_and_execute.
        send_result = send_message(
            draft, recipient_email=recipient_email, recipient_phone=recipient_phone,
            invoice_id=invoice_id, opens_session=(channel != "email"),
        )
        outcome["send_result"] = send_result
        record_message_history({
            "invoice_id": invoice_id,
            "client_name": client_name,
            "channel": channel,
            "subject": draft.subject if channel == "email" else None,
            "body": draft.body,
            "recipient_email": send_result.get("recipient") if channel == "email" else None,
            "recipient": send_result.get("recipient"),
            "status": send_result.get("status"),
            "real_send": send_result.get("real_send", False),
            "autonomous_reply": True,
        })
    else:
        outcome["pending_human_review"] = True
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

    return outcome


def handle_incoming_text(from_phone: str, body: str, channel: str = "sms") -> dict:
    """Entry point for an inbound WhatsApp/SMS message (Twilio's webhook,
    relayed from server.js's POST /api/twilio/webhook via the
    'incoming_text' bridge action) — the text-message equivalent of
    agent/inbox.py's check_for_replies() for email.

    Resolution order for which invoice this belongs to:
      1. An '[INV-XXXX]' tag in the message body (the same tag
         send_message/_tag_body appends to every outbound text) — covers a
         client who quotes/forwards part of the original message back.
      2. Otherwise, the most recently updated ACTIVE conversation whose
         recipient_phone matches the sender — covers the common case of a
         client just typing a fresh reply with no tag at all.
    If neither resolves, there's no conversation to attach this to (a wrong
    number, or a text with no prior outreach on file) — it's logged and
    dropped rather than guessed at.

    Once resolved, this is hands off to the exact same handle_incoming_reply
    used for email — the negotiation/payment-plan logic doesn't care which
    channel a reply arrived on, only memory.py's conversation record does.
    """
    tag_match = INVOICE_TAG_RE.search(body)
    invoice_id = tag_match.group(1) if tag_match else find_active_conversation_by_phone(from_phone)

    if not invoice_id:
        print(f"[NEGOTIATE] Inbound {channel} from {from_phone} matched no active conversation — skipping.", flush=True)
        return {"status": "skipped", "reason": "no matching conversation for this phone number", "from_phone": from_phone}

    return handle_incoming_reply({
        "invoice_id": invoice_id, "body": body, "channel": channel,
        "subject": None, "from_email": None, "from_phone": from_phone,
    })


# Caps how many agent turns a single live call can run to — without this, a
# client who just keeps talking (or a flaky transcription loop) could run up
# an unbounded number of LLM calls on one phone call. 6 is generous for a
# collections call (opening + a few back-and-forths) without being so long
# it reads as the agent stalling; past this it wraps up and hangs up
# regardless of where the conversation was.
MAX_VOICE_TURNS = 6


def handle_voice_turn(invoice_id: str, transcript: str | None, invoice: dict | None = None) -> dict:
    """One leg of a live Twilio Voice call — called by the 'voice_turn'
    bridge action from BOTH of server.js's voice webhooks:

      - POST /api/twilio/voice (the call just connected, transcript=None —
        the client hasn't said anything yet because the agent is the one
        placing this call).
      - POST /api/twilio/voice/gather (Twilio's <Gather input="speech">
        just transcribed what the client said; transcript is that text,
        or '' if the client said nothing before the gather timed out).

    Returns {"say": <exact text to speak now, via TwiML <Say>>, "continue":
    <bool — True means Node should <Gather> again, False means <Hangup>
    after speaking>, "status": ...}. There is deliberately no separate
    "send" step the way there is for email/WhatsApp/SMS: on a live call,
    *speaking* the line IS the send, so whatever reply_body the negotiate
    agent writes goes straight into "say" with no human-approval gate —
    the same AUTO_APPROVE_NEGOTIATION consideration that gates autonomous
    text replies doesn't apply here because there's no asynchronous queue
    to hold a spoken line in; the call is happening right now.

    Reuses the exact same negotiate agent (and NegotiationTurn decision:
    continue_negotiating / resolved / escalate_to_human) that drives email/
    WhatsApp/SMS replies, so a client gets the same judgment whichever
    channel they're on — agent/agents.py's build_negotiate_agent prompt has
    phone-specific instructions (short spoken lines, never read a URL aloud)
    layered on top of the same base behavior.
    """
    convo = get_conversation(invoice_id)
    client_name = (invoice or {}).get("client_name") or (convo or {}).get("client_name") or "there"
    recipient_phone = (invoice or {}).get("phone") or (convo or {}).get("recipient_phone")

    if convo is None or convo.get("status") != "active":
        # get-or-create / reactivate — a voice call is outreach just like
        # the first email/text, and a client who was previously resolved or
        # escalated calling back (or being called back) should still land
        # in an active thread, not a dead one.
        start_conversation(invoice_id, client_name=client_name, recipient_phone=recipient_phone)
        convo = get_conversation(invoice_id)

    is_opening = transcript is None
    if transcript:
        append_conversation_turn(invoice_id, role="client", body=transcript, channel="phone")
        convo = get_conversation(invoice_id)

    # Count only this invoice's PAST phone turns — an invoice already chased
    # by email for months shouldn't have its very first phone call cut short
    # because of unrelated email history.
    phone_agent_turns = sum(
        1 for t in convo.get("turns", []) if t.get("role") == "agent" and t.get("channel") == "phone"
    )
    if phone_agent_turns >= MAX_VOICE_TURNS:
        closing = f"We're about at time for this call — I'll follow up by text with everything we discussed. Thanks, {client_name}."
        append_conversation_turn(invoice_id, role="agent", body=closing, channel="phone")
        record_message_history({
            "invoice_id": invoice_id, "client_name": client_name, "channel": "phone",
            "subject": None, "body": closing, "recipient": recipient_phone,
            "status": "call wrapped up (turn limit)", "real_send": True,
        })
        return {"say": closing, "continue": False, "status": "call_turn_limit_reached"}

    thread_text = "\n\n".join(
        f"[{t.get('role', '?').upper()} via {t.get('channel', 'phone')}]\n{t.get('body', '')}"
        for t in convo.get("turns", [])
    )

    negotiate_agent = build_negotiate_agent()
    if is_opening:
        context = (
            f"Invoice {invoice_id}, client \"{client_name}\". You are placing this call "
            "yourself right now — the client hasn't said anything on this call yet.\n\n"
            + (
                f"Prior contact on this invoice so far (oldest first):\n\n{thread_text}\n\n"
                if thread_text else "There's no prior contact on this invoice yet — this is the "
                "first outreach of any kind.\n\n"
            )
            + "This is your opening turn: introduce yourself briefly, state the reason for the "
            "call in 1-2 short spoken sentences (referencing prior contact only if it's there), "
            "then stop and wait for them to respond. Use outcome='continue_negotiating'."
        )
    else:
        context = (
            f"Invoice {invoice_id}, client \"{client_name}\".\n\n"
            f"Live phone call, full thread so far (oldest first):\n\n{thread_text}\n\n"
            "Decide the outcome for the latest turn, per your instructions."
        )

    try:
        result = negotiate_agent(context)
        decision: NegotiationTurn = result.structured_output
    except Exception as exc:  # noqa: BLE001 - a flaky model call must never leave a live call hanging
        print(f"[VOICE] LLM call failed for {invoice_id} ({exc}) — ending the call and escalating.", flush=True)
        set_conversation_status(invoice_id, "escalated")
        closing = "Sorry — I'm having trouble on my end right now. I'll have someone from our team follow up with you directly."
        append_conversation_turn(invoice_id, role="agent", body=closing, channel="phone")
        return {"say": closing, "continue": False, "status": "escalate_to_human"}

    # A payment link minted mid-call is never spoken aloud (see the
    # negotiate agent's phone-specific instructions) — it's texted for real
    # instead, the moment the agent decides to mint one, so the spoken
    # promise ("I'll text that to you") is always true rather than aspirational.
    if decision.payment_link and recipient_phone:
        send_text_message(
            recipient_phone,
            f"Here's your payment link for invoice {invoice_id}: {decision.payment_link}",
            opens_session=False,
        )

    if decision.installments and len(decision.installments) >= 2:
        now = datetime.now(timezone.utc)
        installment_records = []
        for i, inst in enumerate(decision.installments):
            is_first_and_billed = i == 0 and decision.paypal_order_id
            installment_records.append({
                "index": i,
                "amount_usd": inst.amount_usd,
                "description": inst.description,
                "due_at": (now + timedelta(days=inst.due_in_days)).isoformat(),
                "status": "awaiting_payment" if is_first_and_billed else "scheduled",
                "paypal_order_id": decision.paypal_order_id if is_first_and_billed else None,
                "payment_link": decision.payment_link if is_first_and_billed else None,
            })
        create_payment_plan(invoice_id, client_name=client_name, installments=installment_records)
        if decision.paypal_order_id:
            save_installment_order_mapping(decision.paypal_order_id, invoice_id=invoice_id, client_name=client_name, installment_index=0)

    if decision.outcome == "resolved":
        set_conversation_status(invoice_id, "resolved")
        closing = decision.reply_body or f"Great, thanks {client_name} — that's all I needed. Have a good day."
        append_conversation_turn(invoice_id, role="agent", body=closing, channel="phone")
        record_message_history({
            "invoice_id": invoice_id, "client_name": client_name, "channel": "phone",
            "subject": None, "body": closing, "recipient": recipient_phone,
            "status": "call resolved", "real_send": True,
        })
        return {"say": closing, "continue": False, "status": "resolved"}

    if decision.outcome == "escalate_to_human":
        set_conversation_status(invoice_id, "escalated")
        closing = decision.reply_body or "I'm going to have someone from our team follow up with you directly on this — thanks for your time."
        append_conversation_turn(invoice_id, role="agent", body=closing, channel="phone")
        record_message_history({
            "invoice_id": invoice_id, "client_name": client_name, "channel": "phone",
            "subject": None, "body": closing, "recipient": recipient_phone,
            "status": "call escalated", "real_send": True,
        })
        return {"say": closing, "continue": False, "status": "escalate_to_human"}

    # continue_negotiating
    say_line = decision.reply_body or "Sorry, could you say that again?"
    append_conversation_turn(invoice_id, role="agent", body=say_line, channel="phone")
    return {"say": say_line, "continue": True, "status": "continue_negotiating"}


def process_due_installments() -> list[dict]:
    """Scans every active payment plan for an installment whose due date has
    arrived and hasn't been billed yet, mints its real PayPal order, and
    emails the client a fresh link — no LLM call needed, since the plan's
    terms were already agreed when the negotiate agent created it. Meant to
    run on the same schedule as check_for_replies (see agent_bridge.py's
    handle_check_replies) — one Cloud Scheduler job progresses both the
    negotiation inbox and any plans already in flight.
    """
    results = []
    now = datetime.now(timezone.utc)

    for plan in list_active_payment_plans():
        invoice_id = plan["invoice_id"]
        client_name = plan.get("client_name")
        convo = get_conversation(invoice_id)
        recipient_email = convo.get("recipient_email") if convo else None
        recipient_phone = convo.get("recipient_phone") if convo else None
        # A billing reminder isn't a reply to anything the client just sent —
        # it's business-initiated on a schedule — so it never risks a
        # template-less WhatsApp send (see sms_tools.send_text_message):
        # text-capable clients get it over SMS, which has no session-window
        # restriction, and anyone without a phone on file still gets email.
        bill_channel = "sms" if recipient_phone else "email"

        for installment in plan.get("installments", []):
            if installment.get("status") != "scheduled":
                continue
            try:
                due_at = datetime.fromisoformat(installment["due_at"])
            except Exception:  # noqa: BLE001 - a malformed due_at shouldn't crash the whole poll
                continue
            if due_at > now:
                continue

            index = installment["index"]
            order_result = create_paypal_order(
                invoice_id=invoice_id,
                client_name=client_name,
                amount_usd=installment["amount_usd"],
                description=installment.get("description", f"Installment for {invoice_id}"),
            )

            if order_result.get("error"):
                print(f"[PAYMENT_PLAN] Failed to bill installment {index} of {invoice_id}: {order_result['error']}", flush=True)
                results.append({"invoice_id": invoice_id, "installment_index": index, "status": "billing_failed", "error": order_result["error"]})
                continue

            save_installment_order_mapping(
                order_result["paypal_order_id"], invoice_id=invoice_id, client_name=client_name, installment_index=index,
            )
            update_installment(
                invoice_id, index,
                status="awaiting_payment",
                paypal_order_id=order_result["paypal_order_id"],
                payment_link=order_result.get("payment_link"),
            )

            subject = f"Payment due — {installment.get('description', invoice_id)} [{invoice_id}]"
            link = order_result.get("payment_link") or "(link unavailable)"
            if bill_channel == "email":
                body = (
                    f"Hi {client_name or 'there'},\n\n"
                    f"This is a scheduled payment from the plan we agreed on for invoice "
                    f"{invoice_id}: {installment.get('description', '')}.\n\n"
                    f"Pay instantly via PayPal: {link}\n\n"
                    "The Accounts Team"
                )
            else:
                body = (
                    f"Payment due: {installment.get('description', invoice_id)} for invoice {invoice_id}. "
                    f"Pay instantly via PayPal: {link}"
                )
            draft = DraftedMessage(subject=subject, body=body, channel=bill_channel)
            send_result = send_message(
                draft, recipient_email=recipient_email, recipient_phone=recipient_phone,
                invoice_id=invoice_id, opens_session=False,
            )
            append_conversation_turn(
                invoice_id, role="agent", body=body,
                subject=subject if bill_channel == "email" else None, channel=bill_channel,
            )
            record_message_history({
                "invoice_id": invoice_id,
                "client_name": client_name,
                "channel": bill_channel,
                "subject": subject if bill_channel == "email" else None,
                "body": body,
                "recipient_email": send_result.get("recipient") if bill_channel == "email" else None,
                "recipient": send_result.get("recipient"),
                "status": send_result.get("status"),
                "real_send": send_result.get("real_send", False),
                "autonomous_reply": True,
            })

            results.append({"invoice_id": invoice_id, "installment_index": index, "status": "billed", "paypal_order_id": order_result["paypal_order_id"]})

    return results


def handle_installment_paid(invoice_id: str, installment_index: int, paypal_order_id: str | None = None) -> dict:
    """Called by server.js's PayPal webhook handler (via the 'installment_paid'
    bridge action) when one installment's order is captured — deliberately
    separate from record_payment_confirmed, which closes out the WHOLE
    invoice. Paying installment 1 of 3 should read as progress, not
    completion: the invoice itself is only marked paid once every
    installment in the plan is.
    """
    plan = update_installment(invoice_id, installment_index, status="paid", paid_at=datetime.now(timezone.utc).isoformat())
    if plan is None:
        return {"status": "error", "reason": f"No payment plan / installment {installment_index} found for {invoice_id}"}

    all_paid = plan.get("status") == "completed"
    client_name = plan.get("client_name")

    if all_paid:
        reflection = Reflection(
            was_best_decision=True,
            suggested_tone_shift=f"Client completed the full negotiated payment plan for {invoice_id} — approach validated.",
            suggested_relationship_delta=6,
        )
    else:
        paid_count = sum(1 for i in plan.get("installments", []) if i.get("status") == "paid")
        total = len(plan.get("installments", []))
        reflection = Reflection(
            was_best_decision=True,
            suggested_tone_shift=f"Client paid installment {installment_index + 1} of {total} for {invoice_id} on schedule.",
            suggested_relationship_delta=2,
        )

    record = update_client_memory(client_name, reflection, action_taken="payment_plan_installment_paid", invoice=None)
    return {"status": "completed" if all_paid else "partial", "reflection": reflection, "client_memory": record, "plan": plan}

