"""Real WhatsApp/SMS sending via Twilio's own REST API — the agent's third
outreach channel alongside email (agent/execute.py's send_message). Verified
against the installed `twilio` package (v9.13.0) by inspecting the actual
`twilio.rest.Client` constructor and `messages.create()` signature in
site-packages, not written from memory — same "not from memory" standard
this codebase holds itself to for every other third-party integration (see
README, agent/tools/paypal_tools.py).

A real constraint this surfaced that's worth being upfront about: WhatsApp's
Business API requires a pre-approved message TEMPLATE for any
business-initiated message. Free-form text (a plain `body=`, no template) is
only allowed inside the 24-hour "customer service window" that opens once
the client has messaged *first*. That means:

  - The agent's *first* outreach on an invoice (nothing from the client yet)
    cannot be a free-form WhatsApp message without a Twilio-approved
    template, which isn't something a hackathon sandbox account has set up
    in time. send_text_message() below sends that opening message as plain
    SMS instead — no template, no session window, works immediately.
  - Once the client has replied (by WhatsApp or SMS — either one opens the
    window on that same Twilio number), every agent reply for the next 24h
    can be a genuine free-form WhatsApp body message, which IS what gets
    sent at that point.

This mirrors the PayPal integration's own "the obvious thing is actually
gated — here's what's real right now" shape (see paypal_tools.py's Orders
vs. Invoicing note) rather than silently building something that would 403
or silently no-op on demo day.
"""

import os
from typing import Any

try:
    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException
except ImportError:  # pragma: no cover - twilio is a required dependency once this module is imported
    Client = None  # type: ignore[assignment]
    TwilioRestException = Exception  # type: ignore[assignment,misc]

_twilio_client = None
_client_init_attempted = False


def _build_client():
    """Lazy, cached Twilio client — None (not an exception) if the account
    isn't configured, so send_text_message() degrades to its print-only stub
    exactly like send_message()'s SMTP path does when SMTP_USER/PASS are
    unset. Re-checked once per process, not once per call, since env vars
    don't change mid-run."""
    global _twilio_client, _client_init_attempted
    if _client_init_attempted:
        return _twilio_client
    _client_init_attempted = True

    if Client is None:
        print("[SMS_TOOLS] 'twilio' package not installed — WhatsApp/SMS sending disabled.", flush=True)
        return None

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    if not (account_sid and auth_token):
        return None

    try:
        _twilio_client = Client(account_sid, auth_token)
    except Exception as e:  # noqa: BLE001 - never let a bad Twilio config crash the caller
        print(f"[SMS_TOOLS] Failed to build Twilio client ({e}). WhatsApp/SMS sending disabled.", flush=True)
        _twilio_client = None
    return _twilio_client


def _whatsapp_number(raw: str) -> str:
    return raw if raw.startswith("whatsapp:") else f"whatsapp:{raw}"


def send_text_message(to_phone: str, body: str, opens_session: bool = False) -> dict[str, Any]:
    """Sends `body` to `to_phone` (E.164, e.g. '+14155550100') over WhatsApp
    or SMS via Twilio, falling back to a print-only stub if Twilio isn't
    configured — same graceful-degrade shape as send_message()'s SMTP path.

    opens_session: True once a reply has actually arrived from this client
    this negotiation (handle_incoming_reply sets this) — that inbound message
    is what opens WhatsApp's 24h free-form window, so a genuine WhatsApp
    body message is sent in that case if TWILIO_WHATSAPP_FROM is configured.
    False (the default — used for the very first, business-initiated
    message on an invoice) always sends over plain SMS instead, since a
    template-free WhatsApp send would be rejected outside that window — see
    the module docstring.

    Returns a dict shaped like send_message()'s return value:
    {"status": "sent"|"failed"|"stubbed", "channel_used": "whatsapp"|"sms",
     "real_send": bool, "recipient": str, "message_sid": str|None,
     "error": str|None}
    """
    client = _build_client()
    whatsapp_from = os.environ.get("TWILIO_WHATSAPP_FROM")
    sms_from = os.environ.get("TWILIO_SMS_FROM")

    if client is None or not (whatsapp_from or sms_from):
        print(f"[SEND via whatsapp/sms] (stub — Twilio not configured) To: {to_phone}\n{body}", flush=True)
        return {
            "status": "sent", "channel_used": "sms", "real_send": False,
            "recipient": to_phone, "message_sid": None, "error": None,
        }

    use_whatsapp = opens_session and bool(whatsapp_from)
    channel_used = "whatsapp" if use_whatsapp else "sms"

    try:
        if use_whatsapp:
            message = client.messages.create(
                from_=_whatsapp_number(whatsapp_from), to=_whatsapp_number(to_phone), body=body,
            )
        elif sms_from:
            message = client.messages.create(from_=sms_from, to=to_phone, body=body)
        else:
            # opens_session=True but only a WhatsApp sender is configured
            # (no SMS fallback number) — still send the opening message as
            # WhatsApp rather than silently dropping it. This will be
            # rejected by Twilio/Meta if no template is approved and the
            # window hasn't actually opened; the except branch below
            # reports that clearly instead of crashing the caller.
            message = client.messages.create(
                from_=_whatsapp_number(whatsapp_from), to=_whatsapp_number(to_phone), body=body,
            )
            channel_used = "whatsapp"

        print(f"[SEND via {channel_used}] Real message sent to {to_phone} (sid={message.sid}).", flush=True)
        return {
            "status": "sent", "channel_used": channel_used, "real_send": True,
            "recipient": to_phone, "message_sid": message.sid, "error": None,
        }
    except TwilioRestException as exc:
        print(f"[SEND via {channel_used}] Real send FAILED ({exc.code}: {exc.msg}).", flush=True)
        return {
            "status": "failed", "channel_used": channel_used, "real_send": False,
            "recipient": to_phone, "message_sid": None, "error": f"{exc.code}: {exc.msg}",
        }
    except Exception as exc:  # noqa: BLE001 - never let a send failure break approval/negotiation
        print(f"[SEND via {channel_used}] Real send FAILED ({exc}).", flush=True)
        return {
            "status": "failed", "channel_used": channel_used, "real_send": False,
            "recipient": to_phone, "message_sid": None, "error": str(exc),
        }
