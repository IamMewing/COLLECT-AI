"""Persistent client memory layer for CollectAI Strands Agent.

Keyed by client name. Each record contains:
- relationship_score (0-100)
- preferred_tone (nullable)
- interaction_history (list of {date, action, outcome})
- total_invoices (int)
- on_time_count (int)

Storage backend: Firestore when FIRESTORE_ENABLED=true (survives Cloud Run
cold starts and works correctly across multiple concurrent instances — a
local JSON file does neither), otherwise a JSON file at
agent/data/client_memory.json, same as before this existed. The flag
defaults off so nothing changes for local dev or any deployment that hasn't
set up a Firestore database yet; set it once Firestore is enabled on the
GCP project and the Cloud Run service account has the Datastore User role.

This file is the only place that talks to the storage backend — the rest
of the module (get_client_memory, update_client_memory, etc.) just calls
_load_client / _save_client and doesn't know or care which backend is
behind them.
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
MEMORY_FILE = DATA_DIR / "client_memory.json"
HISTORY_FILE = DATA_DIR / "message_history.json"
CONVERSATIONS_FILE = DATA_DIR / "conversations.json"
PAYMENT_PLANS_FILE = DATA_DIR / "payment_plans.json"

FIRESTORE_ENABLED = os.environ.get("FIRESTORE_ENABLED", "false").strip().lower() in ("true", "1", "yes")

# Lazily-initialized Firestore client + module handle. Both stay None when
# FIRESTORE_ENABLED is off, or if init fails for any reason (missing
# dependency, no credentials, Firestore not yet created on the project) —
# in which case every function below transparently falls back to the local
# JSON file, logged once here so a misconfiguration is visible in Cloud Run
# logs rather than silently losing data with no explanation.
_firestore = None
_firestore_client = None
if FIRESTORE_ENABLED:
    try:
        from google.cloud import firestore as _firestore  # noqa: N812

        _firestore_client = _firestore.Client()
        print("[MEMORY] FIRESTORE_ENABLED=true — using Firestore for client memory and message history.", flush=True)
    except Exception as e:  # noqa: BLE001 - any init failure should degrade, not crash the bridge
        print(
            f"[MEMORY] FIRESTORE_ENABLED=true but Firestore client init failed ({e}). "
            "Falling back to local JSON file — this will NOT survive a Cloud Run cold start.",
            flush=True,
        )
        _firestore = None
        _firestore_client = None

_firestore_failure_logged = False


def _disable_firestore(err: Exception) -> None:
    """Called when a Firestore operation fails at RUNTIME (not at client
    construction — that's the try/except above, which only catches a
    synchronous failure and does NOT catch this one). `firestore.Client()`
    is lazy: it never validates credentials/project-id until the first real
    call, so a bad or missing config surfaces here, not up there. Once this
    fires we turn Firestore off for the rest of the process so every
    subsequent call goes straight to the local JSON fallback instead of
    paying a failed-request's latency (and risking the same crash) on every
    request for an already-known-broken backend."""
    global _firestore_client
    _firestore_client = None
    global _firestore_failure_logged
    if not _firestore_failure_logged:
        _firestore_failure_logged = True
        print(
            f"[MEMORY] Firestore operation failed at runtime ({err}). "
            "Falling back to local JSON file for the rest of this process's lifetime.",
            flush=True,
        )


def _ensure_store_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_store() -> dict[str, dict[str, Any]]:
    """Local-JSON-fallback only: the whole client_memory.json file."""
    _ensure_store_dir()
    if not MEMORY_FILE.exists():
        return {}
    try:
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[MEMORY] Warning: Failed to read {MEMORY_FILE} ({e}). Initializing empty store.")
        return {}


def _save_store(store: dict[str, dict[str, Any]]) -> None:
    """Local-JSON-fallback only: rewrite the whole client_memory.json file."""
    _ensure_store_dir()
    temp_file = MEMORY_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    temp_file.replace(MEMORY_FILE)


def _sanitize_doc_id(key: str) -> str:
    """Firestore document IDs can't contain '/' (and a few other edge
    cases) — client names are free text, so don't trust them verbatim."""
    cleaned = key.strip().replace("/", "_")
    return cleaned or "unknown-client"


def _load_client(client_key: str) -> dict[str, Any] | None:
    """One client's record, or None if it doesn't exist yet."""
    if _firestore_client is not None:
        try:
            doc = _firestore_client.collection("client_memory").document(_sanitize_doc_id(client_key)).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    return _load_store().get(client_key)


def _save_client(client_key: str, record: dict[str, Any]) -> None:
    if _firestore_client is not None:
        try:
            _firestore_client.collection("client_memory").document(_sanitize_doc_id(client_key)).set(record)
            return
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    store = _load_store()
    store[client_key] = record
    _save_store(store)


def record_message_history(entry: dict[str, Any]) -> None:
    """Append one sent (or attempted) message to the durable activity log —
    the audit trail of what the agent actually sent, to whom, and when, that
    the UI's History panel reads from. Best-effort: a logging failure must
    never break the approve flow, the same way a failed real-send already
    falls back to a stub instead of raising (see execute.send_message)."""
    record = {**entry, "timestamp": datetime.now(timezone.utc).isoformat()}
    try:
        if _firestore_client is not None:
            try:
                _firestore_client.collection("message_history").add(record)
                return
            except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
                _disable_firestore(e)
        _ensure_store_dir()
        history: list[dict[str, Any]] = []
        if HISTORY_FILE.exists():
            try:
                history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
            except Exception:
                history = []
        history.append(record)
        # Local-fallback only: cap so a long-running demo session's file
        # doesn't grow unbounded. Firestore has no equivalent cap — querying
        # it is always most-recent-first with a limit (see list_message_history).
        history = history[-500:]
        HISTORY_FILE.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - logging a send must never break the send
        print(f"[MEMORY] Warning: failed to record message history ({e}).", flush=True)


def list_message_history(limit: int = 100) -> list[dict[str, Any]]:
    """Most-recent-first list of sent messages, for the History UI."""
    try:
        if _firestore_client is not None:
            try:
                docs = (
                    _firestore_client.collection("message_history")
                    .order_by("timestamp", direction=_firestore.Query.DESCENDING)
                    .limit(limit)
                    .stream()
                )
                return [d.to_dict() for d in docs]
            except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
                _disable_firestore(e)
        if not HISTORY_FILE.exists():
            return []
        history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        return list(reversed(history))[:limit]
    except Exception as e:  # noqa: BLE001 - an unreadable log shouldn't 500 the page that shows it
        print(f"[MEMORY] Warning: failed to list message history ({e}).", flush=True)
        return []


def has_client_memory(client_name: str) -> bool:
    """Return True if a memory record already exists for this client."""
    if not client_name:
        return False
    return _load_client(client_name.strip()) is not None


# In-memory registry of invoice scores seen during sweeps to ensure
# first-time client record creation always matches the invoice's score.
_known_client_scores: dict[str, int] = {}


def remember_invoice_score(invoice: dict[str, Any]) -> None:
    """Register the invoice's relationship_score for the client so new client records match it."""
    if not isinstance(invoice, dict):
        return
    client_name = invoice.get("client_name")
    if client_name and "relationship_score" in invoice:
        try:
            _known_client_scores[str(client_name).strip()] = int(invoice["relationship_score"])
        except (ValueError, TypeError):
            pass


def get_client_memory(
    client_name: str,
    invoice: dict[str, Any] | None = None,
    initial_score: int | None = None,
) -> dict[str, Any]:
    """Retrieve memory record for a client, or return defaults if new client.

    When creating defaults for a new client, seeds relationship_score from that
    invoice's own relationship_score value (passed in from invoice dict or initial_score),
    ensuring the two never disagree for a client's first interaction.
    """
    if not client_name:
        seed = 70
        if isinstance(invoice, dict) and "relationship_score" in invoice:
            seed = int(invoice["relationship_score"])
        elif initial_score is not None:
            seed = initial_score
        return {
            "relationship_score": seed,
            "preferred_tone": None,
            "interaction_history": [],
            "total_invoices": 1,
            "on_time_count": 1,
        }

    client_key = client_name.strip()
    existing = _load_client(client_key)
    if existing is not None:
        return dict(existing)

    # Determine seed score from invoice dict, initial_score, or remembered sweep score
    seed = 70
    if isinstance(invoice, dict) and "relationship_score" in invoice:
        seed = int(invoice["relationship_score"])
    elif initial_score is not None:
        seed = int(initial_score)
    elif client_key in _known_client_scores:
        seed = _known_client_scores[client_key]

    return {
        "relationship_score": seed,
        "preferred_tone": None,
        "interaction_history": [],
        "total_invoices": 1,
        "on_time_count": 1,
    }


def update_client_memory(
    client_name: str,
    reflection: Any,
    action_taken: str,
    invoice: dict[str, Any] | None = None,
    initial_score: int | None = None,
) -> dict[str, Any]:
    """Apply reflection delta to relationship score, append to interaction history, and persist to file.

    When creating a new client record for the first time, seeds relationship_score from that
    invoice's own relationship_score value (passed in from invoice dict or initial_score),
    not a separate hardcoded default. The two will never disagree for a client's first interaction.

    Args:
        client_name: Name of the client
        reflection: Reflection model or dict containing suggested_relationship_delta & suggested_tone_shift
        action_taken: Description of action, e.g. "approved_and_sent" or "rejected"
        invoice: Optional invoice dict to seed relationship_score for new client
        initial_score: Optional explicit score to seed if client not yet in memory

    Returns:
        The updated client memory record
    """
    if not client_name:
        client_name = "Default Client"

    client_key = client_name.strip()
    record = _load_client(client_key)
    if record is None:
        # Seed new client record directly from the invoice's relationship_score
        record = get_client_memory(client_key, invoice=invoice, initial_score=initial_score)

    # Extract suggested delta from reflection
    delta = 0
    if hasattr(reflection, "suggested_relationship_delta"):
        delta = reflection.suggested_relationship_delta
    elif isinstance(reflection, dict) and "suggested_relationship_delta" in reflection:
        delta = reflection["suggested_relationship_delta"]

    # Extract outcome from reflection
    outcome = "No reflection recorded"
    if hasattr(reflection, "suggested_tone_shift"):
        outcome = reflection.suggested_tone_shift
    elif isinstance(reflection, dict) and "suggested_tone_shift" in reflection:
        outcome = reflection["suggested_tone_shift"]

    # Apply delta clamped between 0 and 100
    current_score = record.get("relationship_score", 70)
    new_score = max(0, min(100, current_score + delta))
    record["relationship_score"] = new_score

    # Append interaction
    record.setdefault("interaction_history", []).append({
        "date": datetime.now(timezone.utc).isoformat(),
        "action": action_taken,
        "outcome": outcome,
    })

    _save_client(client_key, record)
    return record


def extract_client_name_from_draft(draft: Any) -> str:
    """Helper to extract recipient client name from draft body if not explicitly provided."""
    body = getattr(draft, "body", "") if hasattr(draft, "body") else str(draft.get("body", ""))
    match = re.search(r"(?:Hi|Hope you're doing well,)\s+([^,\n!]+)", body)
    if match:
        return match.group(1).strip()
    return "Unknown Client"


# ── Conversation threads (autonomous negotiation loop) ──────────────────────
# Keyed by invoice_id. One record per invoice tracks the back-and-forth once
# the first outreach is sent: who to reply to, every turn in order, and a
# status the inbox poller (agent/inbox.py) and the negotiate agent
# (agent/execute.py's handle_incoming_reply) use to decide whether an
# incoming email is even still something to act on. Same Firestore-or-
# local-JSON pattern as everything else in this file, so it degrades the
# same way if Firestore isn't configured or fails at runtime.


def _load_conversations_store() -> dict[str, dict[str, Any]]:
    _ensure_store_dir()
    if not CONVERSATIONS_FILE.exists():
        return {}
    try:
        with open(CONVERSATIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[MEMORY] Warning: Failed to read {CONVERSATIONS_FILE} ({e}). Initializing empty store.")
        return {}


def _save_conversations_store(store: dict[str, dict[str, Any]]) -> None:
    _ensure_store_dir()
    temp_file = CONVERSATIONS_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    temp_file.replace(CONVERSATIONS_FILE)


def get_conversation(invoice_id: str) -> dict[str, Any] | None:
    """One invoice's conversation record, or None if outreach hasn't started
    a tracked thread for it yet (e.g. it was never sent, or was sent before
    this feature existed)."""
    if not invoice_id:
        return None
    if _firestore_client is not None:
        try:
            doc = _firestore_client.collection("conversations").document(_sanitize_doc_id(invoice_id)).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    return _load_conversations_store().get(invoice_id)


def _save_conversation(invoice_id: str, record: dict[str, Any]) -> None:
    if _firestore_client is not None:
        try:
            _firestore_client.collection("conversations").document(_sanitize_doc_id(invoice_id)).set(record)
            return
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    store = _load_conversations_store()
    store[invoice_id] = record
    _save_conversations_store(store)


def start_conversation(
    invoice_id: str,
    client_name: str,
    recipient_email: str | None = None,
    recipient_phone: str | None = None,
) -> dict[str, Any]:
    """Get-or-create: called right after the first outreach for an invoice is
    actually sent. If a thread already exists (e.g. a previous round that got
    resolved or escalated), this reactivates it to 'active' rather than
    wiping its history — a client re-chased later should still see the
    agent remember the earlier exchange.

    recipient_phone (E.164, e.g. '+14155550100') is set when outreach went
    out over WhatsApp/SMS (see agent/tools/sms_tools.py) — it's what lets
    find_active_conversation_by_phone() match an inbound text back to this
    thread, the same role recipient_email plays for inbound IMAP replies."""
    existing = get_conversation(invoice_id)
    now = datetime.now(timezone.utc).isoformat()
    if existing is not None:
        existing["status"] = "active"
        existing["updated_at"] = now
        existing["recipient_email"] = recipient_email or existing.get("recipient_email")
        existing["recipient_phone"] = recipient_phone or existing.get("recipient_phone")
        _save_conversation(invoice_id, existing)
        return existing

    record = {
        "invoice_id": invoice_id,
        "client_name": client_name,
        "recipient_email": recipient_email,
        "recipient_phone": recipient_phone,
        "status": "active",
        "turns": [],
        "created_at": now,
        "updated_at": now,
    }
    _save_conversation(invoice_id, record)
    return record


def append_conversation_turn(
    invoice_id: str, role: str, body: str, subject: str | None = None, channel: str = "email"
) -> dict[str, Any]:
    """Appends one turn ('agent' or 'client') to an invoice's conversation
    and persists it. Assumes start_conversation() has already been called
    for this invoice — callers in execute.py guarantee that.

    channel ('email' | 'whatsapp' | 'sms') records which channel this
    specific turn happened on — a thread can switch channels mid-conversation
    (e.g. the agent emails, the client replies on WhatsApp instead), and the
    UI's negotiation panel shows it per-turn rather than assuming one
    channel for the whole thread."""
    record = get_conversation(invoice_id)
    if record is None:
        # Defensive fallback — should not normally happen, but a thread
        # must exist to append to rather than silently dropping a reply.
        record = start_conversation(invoice_id, client_name="Unknown Client")

    record.setdefault("turns", []).append({
        "role": role,
        "subject": subject,
        "body": body,
        "channel": channel,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    record["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_conversation(invoice_id, record)
    return record


def _normalize_phone(phone: str) -> str:
    """'whatsapp:+1 (415) 555-0100' -> '+14155550100' — strips the Twilio
    whatsapp: prefix and any formatting punctuation, so a number stored at
    outreach time matches one Twilio reports on an inbound webhook even if
    formatted slightly differently."""
    digits = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    return digits


def find_active_conversation_by_phone(phone: str) -> str | None:
    """Reverse lookup for inbound WhatsApp/SMS: given the phone number Twilio
    reports as the sender, find the most recently updated ACTIVE conversation
    whose recipient_phone matches — the phone-based equivalent of matching an
    email reply by its [INV-XXXX] subject tag. Only 'active' threads are
    candidates, same reasoning as handle_incoming_reply's own status check:
    a resolved/escalated thread shouldn't silently reopen just because the
    same number texts again about something else."""
    target = _normalize_phone(phone)
    if not target:
        return None

    if _firestore_client is not None:
        try:
            docs = (
                _firestore_client.collection("conversations")
                .where("status", "==", "active")
                .stream()
            )
            candidates = [d.to_dict() for d in docs]
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
            candidates = None
    else:
        candidates = None

    if candidates is None:
        candidates = [
            r for r in _load_conversations_store().values() if r.get("status") == "active"
        ]

    matches = [
        r for r in candidates
        if r.get("recipient_phone") and _normalize_phone(r["recipient_phone"]) == target
    ]
    if not matches:
        return None
    matches.sort(key=lambda r: r.get("updated_at", ""), reverse=True)
    return matches[0].get("invoice_id")


def set_conversation_status(invoice_id: str, status: str) -> dict[str, Any] | None:
    """status is one of 'active' | 'resolved' | 'escalated'."""
    record = get_conversation(invoice_id)
    if record is None:
        return None
    record["status"] = status
    record["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_conversation(invoice_id, record)
    return record


# ── Payment plans (multi-installment negotiated agreements) ─────────────────
# One record per invoice, created when the negotiate agent's NegotiationTurn
# comes back with 2+ installments (see agent/execute.py's
# handle_incoming_reply). Each installment tracks its own status and PayPal
# order independently, so paying installment 1 doesn't get mistaken for the
# whole invoice being settled — see server.js's webhook handler, which reads
# the order-mapping 'kind'/'installment_index' tag (agent/tools/paypal_tools.py)
# to know which case it's in. Same Firestore-or-local-JSON pattern as
# everything else here.


def _load_payment_plans_store() -> dict[str, dict[str, Any]]:
    _ensure_store_dir()
    if not PAYMENT_PLANS_FILE.exists():
        return {}
    try:
        with open(PAYMENT_PLANS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[MEMORY] Warning: Failed to read {PAYMENT_PLANS_FILE} ({e}). Initializing empty store.")
        return {}


def _save_payment_plans_store(store: dict[str, dict[str, Any]]) -> None:
    _ensure_store_dir()
    temp_file = PAYMENT_PLANS_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    temp_file.replace(PAYMENT_PLANS_FILE)


def get_payment_plan(invoice_id: str) -> dict[str, Any] | None:
    if not invoice_id:
        return None
    if _firestore_client is not None:
        try:
            doc = _firestore_client.collection("payment_plans").document(_sanitize_doc_id(invoice_id)).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    return _load_payment_plans_store().get(invoice_id)


def _save_payment_plan(invoice_id: str, record: dict[str, Any]) -> None:
    if _firestore_client is not None:
        try:
            _firestore_client.collection("payment_plans").document(_sanitize_doc_id(invoice_id)).set(record)
            return
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    store = _load_payment_plans_store()
    store[invoice_id] = record
    _save_payment_plans_store(store)


def create_payment_plan(invoice_id: str, client_name: str, installments: list[dict[str, Any]]) -> dict[str, Any]:
    """Creates (or replaces) an invoice's payment plan. Each item in
    `installments` must already have amount_usd, due_at (absolute ISO
    timestamp — agent/execute.py converts the agent's relative due_in_days
    to this before calling here), description, and status ('scheduled' or
    'awaiting_payment' for one already billed this turn)."""
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "invoice_id": invoice_id,
        "client_name": client_name,
        "status": "active",
        "installments": installments,
        "created_at": now,
        "updated_at": now,
    }
    _save_payment_plan(invoice_id, record)
    return record


def update_installment(
    invoice_id: str, installment_index: int, **fields: Any
) -> dict[str, Any] | None:
    """Merges `fields` into one installment (0-based index) of an invoice's
    plan — e.g. update_installment(inv_id, 1, status='awaiting_payment',
    paypal_order_id='...', payment_link='...'). Also rolls the plan's own
    status to 'completed' once every installment is marked 'paid'."""
    plan = get_payment_plan(invoice_id)
    if plan is None or not (0 <= installment_index < len(plan.get("installments", []))):
        return None

    plan["installments"][installment_index].update(fields)
    plan["updated_at"] = datetime.now(timezone.utc).isoformat()

    if all(inst.get("status") == "paid" for inst in plan["installments"]):
        plan["status"] = "completed"

    _save_payment_plan(invoice_id, plan)
    return plan


def list_active_payment_plans() -> list[dict[str, Any]]:
    """All plans still in progress — what agent/execute.py's
    process_due_installments scans on each scheduled poll to find
    installments that have come due."""
    if _firestore_client is not None:
        try:
            docs = _firestore_client.collection("payment_plans").where("status", "==", "active").stream()
            return [d.to_dict() for d in docs]
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    store = _load_payment_plans_store()
    return [plan for plan in store.values() if plan.get("status") == "active"]


def list_all_conversations() -> list[dict[str, Any]]:
    """Every tracked conversation thread regardless of status (active,
    resolved, escalated) — for the UI's negotiation panel, not for any
    scheduled job (which only cares about 'active' ones)."""
    if _firestore_client is not None:
        try:
            docs = _firestore_client.collection("conversations").stream()
            return [d.to_dict() for d in docs]
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    return list(_load_conversations_store().values())


def list_all_payment_plans() -> list[dict[str, Any]]:
    """Every payment plan regardless of status — for the UI's negotiation
    panel, which should still show a completed plan's history, not just
    plans still in progress (see list_active_payment_plans for that)."""
    if _firestore_client is not None:
        try:
            docs = _firestore_client.collection("payment_plans").stream()
            return [d.to_dict() for d in docs]
        except Exception as e:  # noqa: BLE001 - degrade to local JSON, don't crash the bridge
            _disable_firestore(e)
    return list(_load_payment_plans_store().values())
