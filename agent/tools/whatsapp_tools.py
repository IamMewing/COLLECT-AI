"""Real WhatsApp sending via Meta's own WhatsApp Cloud API — direct to
graph.facebook.com, with no Twilio involved. This replaces Twilio as the
WhatsApp channel's backend (see agent/execute.py's send_message) because a
genuinely free Twilio phone number usable via the REST API (not just the
console's own canned "Try out" demo) requires upgrading to a paid account,
and plain SMS to Indian numbers additionally runs into TRAI's DLT sender
registration requirement regardless of provider. Meta's Cloud API sidesteps
both: during development it gives a free test number (no card required) that
can message up to a handful of phone numbers you register as testers, and
WhatsApp isn't subject to India's SMS-specific DLT rules.

Verified against Meta's own documented request/response shape for
POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages
(see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
— this project has no Meta app of its own yet to test a live call against
from this environment (outbound network here is restricted to package
registries), so unlike sms_tools.py/paypal_tools.py this hasn't been
exercised against a real response, only built to the documented contract.
Treat the exact error-handling branches below as unverified until a real
send has actually been tried from a deployed environment with network
access to graph.facebook.com — see README for that verification step.

There is no SMS fallback here (unlike the old Twilio path) — WhatsApp is now
the only phone channel, via this module. send_message() in execute.py simply
attempts a real send on every call when configured, instead of pre-emptively
guessing whether the 24h "customer service window" is open the way the old
Twilio code did with its SMS-vs-WhatsApp branch: Meta's API is the source of
truth on whether a given send is actually allowed right now, so a rejected
send is reported honestly (status='failed', with Meta's own error message)
rather than silently assumed to need different handling in advance. In
practice that means: the agent's first, business-initiated outreach on a
phone-only invoice will fail here unless an approved message template is
configured (this project doesn't have one set up — see README), while any
reply to a message the client sent first will succeed, since that's what
opens the 24h window.
"""

import os
from typing import Any

try:
    import requests
except ImportError:  # pragma: no cover - requests is a required dependency once this module is imported
    requests = None  # type: ignore[assignment]

GRAPH_API_VERSION = "v21.0"


def _normalize_recipient(raw: str) -> str:
    """Meta's API wants digits only (country code included, no '+', no
    spaces/dashes) — e.g. '+91 98765-43210' -> '919876543210'."""
    return "".join(ch for ch in raw if ch.isdigit())


def is_configured() -> bool:
    """Surfaced for a status endpoint, same purpose as paypalService's
    isConfigured()/sms_tools' implicit check — lets the UI show whether this
    is actually wired up instead of silently falling back to the stub."""
    return bool(os.environ.get("META_WHATSAPP_ACCESS_TOKEN") and os.environ.get("META_WHATSAPP_PHONE_NUMBER_ID"))


def send_whatsapp_message(to_phone: str, body: str, opens_session: bool = False) -> dict[str, Any]:
    """Sends `body` to `to_phone` as a real WhatsApp message via Meta's
    Cloud API, falling back to a print-only stub if it isn't configured —
    same graceful-degrade shape as every other real-send path in this
    project (send_message()'s SMTP branch, the old sms_tools.send_text_message).

    `opens_session` is accepted for call-site compatibility with the old
    Twilio-backed signature (agent/execute.py passes it the same way) but
    isn't used to branch here — see the module docstring for why: Meta's API
    is simply asked, and it answers honestly whether the window is open.

    Returns a dict shaped exactly like sms_tools.send_text_message()'s old
    contract so execute.py's send_message() didn't need to change its own
    return handling when this replaced it:
    {"status": "sent"|"failed", "channel_used": "whatsapp",
     "real_send": bool, "recipient": str, "message_sid": str|None,
     "error": str|None}
    """
    access_token = os.environ.get("META_WHATSAPP_ACCESS_TOKEN")
    phone_number_id = os.environ.get("META_WHATSAPP_PHONE_NUMBER_ID")

    if requests is None or not (access_token and phone_number_id):
        print(f"[SEND via whatsapp] (stub — Meta WhatsApp not configured) To: {to_phone}\n{body}", flush=True)
        return {
            "status": "sent", "channel_used": "whatsapp", "real_send": False,
            "recipient": to_phone, "message_sid": None, "error": None,
        }

    recipient = _normalize_recipient(to_phone)
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "text",
        "text": {"body": body, "preview_url": False},
    }

    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=15,
        )
        data = resp.json() if resp.content else {}

        if resp.status_code >= 400 or "error" in data:
            err = data.get("error", {})
            code_part = str(err.get("code", resp.status_code))
            if err.get("error_subcode"):
                code_part += f"/{err['error_subcode']}"
            detail = err.get("error_user_msg") or err.get("message") or resp.text[:200]
            error_msg = f"{code_part}: {detail}"
            print(f"[SEND via whatsapp] Real send FAILED ({error_msg}).", flush=True)
            return {
                "status": "failed", "channel_used": "whatsapp", "real_send": False,
                "recipient": to_phone, "message_sid": None, "error": error_msg,
            }

        message_id = (data.get("messages") or [{}])[0].get("id")
        print(f"[SEND via whatsapp] Real message sent to {to_phone} (id={message_id}).", flush=True)
        return {
            "status": "sent", "channel_used": "whatsapp", "real_send": True,
            "recipient": to_phone, "message_sid": message_id, "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - never let a send failure break approval/negotiation
        print(f"[SEND via whatsapp] Real send FAILED ({exc}).", flush=True)
        return {
            "status": "failed", "channel_used": "whatsapp", "real_send": False,
            "recipient": to_phone, "message_sid": None, "error": str(exc),
        }
