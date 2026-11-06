"""Inbound-reply polling for the autonomous negotiation loop.

Deliberately uses IMAP with the SAME Gmail App Password already configured
for outbound send (SMTP_USER/SMTP_PASS — see execute.py's send_message),
instead of the Gmail API's push-notification path (which needs a Google
Cloud Pub/Sub topic, domain verification, and an OAuth consent screen). An
App Password already authorizes IMAP just as it does SMTP, so this needs
zero extra setup beyond what real email sending already required — the
right trade-off for a hackathon build, at the cost of polling instead of
instant push delivery.

How matching works: every outbound message this app sends has its subject
tagged with "[INV-XXXX]" (see execute.py's send_message). Most mail clients
preserve the original subject verbatim on reply (prefixed with "Re:"), so
searching unseen mail for that tag reliably finds which invoice/conversation
a reply belongs to without needing In-Reply-To/References header threading,
which not all clients populate reliably.
"""

import email
import imaplib
import os
import re
from email.header import decode_header
from typing import Any

INVOICE_TAG_RE = re.compile(r"\[(INV-[A-Za-z0-9\-]+)\]")

# Common quoted-reply markers most mail clients prepend to earlier messages.
# Cutting the body off at the first match means the negotiate agent sees
# only the client's NEW text, not the whole thread re-quoted beneath it.
_QUOTE_MARKERS = [
    re.compile(r"\nOn .{0,120} wrote:\s*\n", re.IGNORECASE),
    re.compile(r"\n-{2,}\s*Original Message\s*-{2,}", re.IGNORECASE),
    re.compile(r"\nFrom:\s.*\nSent:\s", re.IGNORECASE),
    re.compile(r"\n>.*"),  # first quoted '>' line onward
]


def _decode_header_value(raw: str) -> str:
    parts = decode_header(raw or "")
    out = ""
    for text, enc in parts:
        if isinstance(text, bytes):
            out += text.decode(enc or "utf-8", errors="replace")
        else:
            out += text
    return out


def _strip_quoted_reply(body: str) -> str:
    cut_at = len(body)
    for pattern in _QUOTE_MARKERS:
        match = pattern.search(body)
        if match:
            cut_at = min(cut_at, match.start())
    return body[:cut_at].strip()


def _extract_body(msg: "email.message.Message") -> str:
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition") or "")
            if content_type == "text/plain" and "attachment" not in disposition:
                charset = part.get_content_charset() or "utf-8"
                try:
                    raw = part.get_payload(decode=True)
                    if raw is not None:
                        return _strip_quoted_reply(raw.decode(charset, errors="replace"))
                except Exception:  # noqa: BLE001 - try the next part rather than fail the whole reply
                    continue
        return ""
    charset = msg.get_content_charset() or "utf-8"
    try:
        raw = msg.get_payload(decode=True)
        return _strip_quoted_reply(raw.decode(charset, errors="replace")) if raw is not None else ""
    except Exception:  # noqa: BLE001 - a malformed single-part body shouldn't crash the poll
        return ""


def _imap_connect() -> "imaplib.IMAP4_SSL | None":
    """Reuses the same credentials as real-email sending. Returns None (not
    an exception) when they're not configured, so a missing/partial setup
    degrades to 'no replies found' instead of crashing the whole poll —
    the same philosophy as send_message's own graceful fallback."""
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    if not (user and password):
        return None

    host = os.environ.get("IMAP_HOST", "imap.gmail.com")
    port = int(os.environ.get("IMAP_PORT", "993"))
    conn = imaplib.IMAP4_SSL(host, port, timeout=20)
    conn.login(user, password)
    return conn


def check_for_replies(mark_seen: bool = True) -> list[dict[str, Any]]:
    """Polls the inbox for unseen messages and returns the ones that look
    like replies to a CollectAI outreach (subject contains an "[INV-XXXX]"
    tag). Messages with no recognizable tag are left exactly as found
    (never marked seen, never acted on) — this inbox is a real inbox, not
    a dedicated one, so most unseen mail here has nothing to do with
    invoices at all.

    Returns a list of dicts: {invoice_id, from_email, subject, body}.
    """
    try:
        conn = _imap_connect()
    except Exception as exc:  # noqa: BLE001 - a bad IMAP login must not crash the sweep/poll endpoint
        print(f"[INBOX] IMAP connection failed ({exc}) — skipping this poll.", flush=True)
        return []

    if conn is None:
        print("[INBOX] SMTP_USER/SMTP_PASS not set — skipping reply check.", flush=True)
        return []

    replies: list[dict[str, Any]] = []
    try:
        conn.select("INBOX")
        status, data = conn.search(None, "UNSEEN")
        if status != "OK" or not data or not data[0]:
            return []

        for message_id in data[0].split():
            status, msg_data = conn.fetch(message_id, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue

            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            subject = _decode_header_value(msg.get("Subject", ""))
            from_email = email.utils.parseaddr(msg.get("From", ""))[1]

            match = INVOICE_TAG_RE.search(subject)
            if not match:
                # Not one of ours — leave it unread, untouched.
                continue

            replies.append({
                "invoice_id": match.group(1),
                "from_email": from_email,
                "subject": subject,
                "body": _extract_body(msg),
            })

            if mark_seen:
                conn.store(message_id, "+FLAGS", "\\Seen")
    except Exception as exc:  # noqa: BLE001 - a mid-poll failure should return whatever was found, not crash
        print(f"[INBOX] Error while polling inbox ({exc}) — returning {len(replies)} reply(ies) found so far.", flush=True)
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001 - logout failing is never worth surfacing
            pass

    return replies
