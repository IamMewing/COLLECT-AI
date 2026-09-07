"""Persistent client memory layer for CollectAI Strands Agent.

Provides a JSON-file-backed store at agent/data/client_memory.json.
Keyed by client name. Each record contains:
- relationship_score (0-100)
- preferred_tone (nullable)
- interaction_history (list of {date, action, outcome})
- total_invoices (int)
- on_time_count (int)
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
MEMORY_FILE = DATA_DIR / "client_memory.json"


def _ensure_store_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_store() -> dict[str, dict[str, Any]]:
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
    _ensure_store_dir()
    temp_file = MEMORY_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    temp_file.replace(MEMORY_FILE)


def has_client_memory(client_name: str) -> bool:
    """Return True if a memory record already exists in the file for this client."""
    if not client_name:
        return False
    store = _load_store()
    return client_name.strip() in store


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
    store = _load_store()
    if client_key in store:
        return dict(store[client_key])

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
    store = _load_store()

    if client_key not in store:
        # Seed new client record directly from the invoice's relationship_score
        store[client_key] = get_client_memory(client_key, invoice=invoice, initial_score=initial_score)

    record = store[client_key]

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

    _save_store(store)
    return record


def extract_client_name_from_draft(draft: Any) -> str:
    """Helper to extract recipient client name from draft body if not explicitly provided."""
    body = getattr(draft, "body", "") if hasattr(draft, "body") else str(draft.get("body", ""))
    match = re.search(r"(?:Hi|Hope you're doing well,)\s+([^,\n!]+)", body)
    if match:
        return match.group(1).strip()
    return "Unknown Client"
