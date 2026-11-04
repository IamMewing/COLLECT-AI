"""Tests for the client-memory and message-history logic in agent/memory.py
(local-JSON-fallback path — the isolated_agent_memory fixture in conftest.py
points DATA_DIR/MEMORY_FILE/HISTORY_FILE at a throwaway tmp_path for every
test, so FIRESTORE_ENABLED is irrelevant here and nothing touches the real
agent/data/*.json the live demo reads and writes).
"""

from agent.memory import (
    get_client_memory,
    update_client_memory,
    has_client_memory,
    record_message_history,
    list_message_history,
)
from agent.models import Reflection


def test_new_client_has_no_memory_yet():
    assert has_client_memory("Someone New") is False


def test_new_client_seeds_relationship_score_from_the_invoice():
    # A brand-new client's first-ever record must start from that specific
    # invoice's relationship_score, not a fixed default — two different
    # invoices for two different first-time clients shouldn't collide on
    # the same starting number.
    record = get_client_memory("Fresh Co", invoice={"relationship_score": 42})
    assert record["relationship_score"] == 42
    assert record["interaction_history"] == []


def test_new_client_with_no_invoice_context_falls_back_to_70():
    record = get_client_memory("Unknown Context Co")
    assert record["relationship_score"] == 70


def test_update_client_memory_applies_the_reflection_delta():
    reflection = Reflection(was_best_decision=True, suggested_tone_shift="keep it up", suggested_relationship_delta=5)
    record = update_client_memory("Delta Co", reflection, action_taken="approved_and_sent", invoice={"relationship_score": 60})
    assert record["relationship_score"] == 65  # 60 + 5
    assert len(record["interaction_history"]) == 1
    assert record["interaction_history"][0]["action"] == "approved_and_sent"
    assert record["interaction_history"][0]["outcome"] == "keep it up"


def test_relationship_score_clamps_at_0_and_100():
    big_drop = Reflection(was_best_decision=False, suggested_tone_shift="bad", suggested_relationship_delta=-10)
    low = update_client_memory("Floor Co", big_drop, action_taken="rejected_by_reviewer", invoice={"relationship_score": 5})
    assert low["relationship_score"] == 0  # would be -5 unclamped

    big_gain = Reflection(was_best_decision=True, suggested_tone_shift="great", suggested_relationship_delta=10)
    high = update_client_memory("Ceiling Co", big_gain, action_taken="approved_and_sent", invoice={"relationship_score": 95})
    assert high["relationship_score"] == 100  # would be 105 unclamped


def test_interaction_history_accumulates_across_calls_for_the_same_client():
    r1 = Reflection(was_best_decision=True, suggested_tone_shift="first", suggested_relationship_delta=1)
    r2 = Reflection(was_best_decision=True, suggested_tone_shift="second", suggested_relationship_delta=1)
    update_client_memory("Repeat Client Co", r1, action_taken="approved_and_sent", invoice={"relationship_score": 50})
    record = update_client_memory("Repeat Client Co", r2, action_taken="approved_and_sent", invoice={"relationship_score": 50})

    assert record["relationship_score"] == 52
    assert len(record["interaction_history"]) == 2
    assert [h["outcome"] for h in record["interaction_history"]] == ["first", "second"]


def test_message_history_round_trips_and_is_most_recent_first():
    record_message_history({"invoice_id": "INV-1", "client_name": "A", "channel": "email", "subject": "s1", "body": "b1", "status": "sent"})
    record_message_history({"invoice_id": "INV-2", "client_name": "B", "channel": "email", "subject": "s2", "body": "b2", "status": "sent"})

    entries = list_message_history(limit=10)
    assert len(entries) == 2
    # Most recently recorded entry comes back first.
    assert entries[0]["invoice_id"] == "INV-2"
    assert entries[1]["invoice_id"] == "INV-1"
    assert "timestamp" in entries[0]


def test_message_history_respects_the_limit():
    for i in range(5):
        record_message_history({"invoice_id": f"INV-{i}", "client_name": "Bulk Co", "channel": "email", "subject": "s", "body": "b", "status": "sent"})

    assert len(list_message_history(limit=2)) == 2
    assert len(list_message_history(limit=100)) == 5
