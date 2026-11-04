"""Tests for calculate_risk_score (agent/tools/risk.py).

Expected scores below were computed independently from the documented
formula (see the module docstring's per-factor comments), not by calling
the function under test — the point is to catch the formula itself
drifting, not to restate it. Each per-factor cap (lateness 40, exposure
20, unresponsiveness 25, relationship 15) is exercised at or past its
cap, and each category boundary (25/50/75) is tested on both sides.
"""

from agent.tools.risk import calculate_risk_score


def test_zero_everything_is_low_risk():
    # No lateness, no exposure, no ignored reminders, perfect relationship.
    result = calculate_risk_score(days_overdue=0, amount=0, ignored_reminders=0, relationship_score=100)
    assert result == {"score": 0, "category": "Low"}


def test_everything_maxed_clamps_to_100_critical():
    # Every factor well past its individual cap.
    result = calculate_risk_score(days_overdue=1000, amount=10_000_000, ignored_reminders=100, relationship_score=0)
    assert result == {"score": 100, "category": "Critical"}


def test_lateness_factor_caps_at_40_points():
    # days_overdue * 1.2 would exceed 40 past ~33.3 days; the function
    # must cap it there rather than letting lateness alone dominate.
    just_under_cap = calculate_risk_score(days_overdue=30, amount=0, ignored_reminders=0, relationship_score=100)
    at_and_past_cap = calculate_risk_score(days_overdue=40, amount=0, ignored_reminders=0, relationship_score=100)
    way_past_cap = calculate_risk_score(days_overdue=400, amount=0, ignored_reminders=0, relationship_score=100)
    assert just_under_cap["score"] == 36  # round(30 * 1.2)
    assert at_and_past_cap["score"] == 40
    assert way_past_cap["score"] == 40  # capped, not 480


def test_exposure_factor_caps_at_20_points():
    at_cap = calculate_risk_score(days_overdue=0, amount=200_000, ignored_reminders=0, relationship_score=100)
    past_cap = calculate_risk_score(days_overdue=0, amount=5_000_000, ignored_reminders=0, relationship_score=100)
    assert at_cap["score"] == 20
    assert past_cap["score"] == 20


def test_unresponsiveness_factor_caps_at_25_points():
    # 4 ignored reminders * 8 = 32, already past the 25-point cap.
    result = calculate_risk_score(days_overdue=0, amount=0, ignored_reminders=4, relationship_score=100)
    assert result["score"] == 25


def test_relationship_factor_caps_at_15_points_for_a_zero_score_client():
    result = calculate_risk_score(days_overdue=0, amount=0, ignored_reminders=0, relationship_score=0)
    assert result["score"] == 15


def test_category_boundary_low_to_medium():
    below = calculate_risk_score(days_overdue=20, amount=0, ignored_reminders=0, relationship_score=100)
    at = calculate_risk_score(days_overdue=21, amount=0, ignored_reminders=0, relationship_score=100)
    assert below == {"score": 24, "category": "Low"}
    assert at == {"score": 25, "category": "Medium"}


def test_category_boundary_medium_to_high():
    below = calculate_risk_score(days_overdue=33, amount=98_000, ignored_reminders=0, relationship_score=100)
    at = calculate_risk_score(days_overdue=33, amount=100_000, ignored_reminders=0, relationship_score=100)
    assert below == {"score": 49, "category": "Medium"}
    assert at == {"score": 50, "category": "High"}


def test_category_boundary_high_to_critical():
    below = calculate_risk_score(days_overdue=33, amount=100_000, ignored_reminders=3, relationship_score=100)
    at = calculate_risk_score(days_overdue=33, amount=110_000, ignored_reminders=3, relationship_score=100)
    assert below == {"score": 74, "category": "High"}
    assert at == {"score": 75, "category": "Critical"}


def test_a_realistic_mixed_invoice():
    # 25 days late, a mid-size invoice, one ignored reminder, decent
    # standing — exercises all four factors at once, none capped.
    result = calculate_risk_score(days_overdue=25, amount=100_000, ignored_reminders=1, relationship_score=70)
    assert result == {"score": 52, "category": "High"}


def test_score_never_exceeds_100_even_with_absurd_inputs():
    result = calculate_risk_score(days_overdue=999_999, amount=999_999_999, ignored_reminders=999, relationship_score=-999)
    assert result["score"] <= 100
    assert result["category"] == "Critical"
