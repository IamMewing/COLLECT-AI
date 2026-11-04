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
