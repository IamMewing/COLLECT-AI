"""Tests for predict_payment_probability (agent/tools/probability.py).

Expected probabilities below were computed independently from the
documented formula, not by calling the function under test. Covers the
base-rate pass-through, each penalty term, the 0-100 clamp in both
directions, and the relationship_score>=50 case where that penalty term
goes to zero rather than negative (a client already at or above the
50-point midpoint earns no extra penalty, but also no bonus).
"""

from agent.tools.probability import predict_payment_probability


def test_perfect_client_nothing_overdue_is_100_percent():
    result = predict_payment_probability(
        days_overdue=0, ignored_reminders=0, relationship_score=100, historical_on_time_rate=1.0
    )
    assert result["probability"] == 100


def test_worst_possible_client_is_0_percent():
    result = predict_payment_probability(
        days_overdue=0, ignored_reminders=0, relationship_score=0, historical_on_time_rate=0.0
    )
    assert result["probability"] == 0


def test_probability_clamps_to_0_rather_than_going_negative():
    # Penalty terms alone (1000 * 0.5 = 500, 100 * 10 = 1000) dwarf a 100%
    # base rate many times over — must floor at 0, not report a negative.
    result = predict_payment_probability(
        days_overdue=1000, ignored_reminders=100, relationship_score=0, historical_on_time_rate=1.0
    )
    assert result["probability"] == 0


def test_days_overdue_penalty_is_half_a_point_per_day():
    baseline = predict_payment_probability(
        days_overdue=0, ignored_reminders=0, relationship_score=100, historical_on_time_rate=0.9
    )
    ten_days_late = predict_payment_probability(
        days_overdue=10, ignored_reminders=0, relationship_score=100, historical_on_time_rate=0.9
    )
    assert baseline["probability"] == 90
    assert ten_days_late["probability"] == 85  # 90 - (10 * 0.5)


def test_each_ignored_reminder_costs_10_points():
    one_reminder = predict_payment_probability(
        days_overdue=0, ignored_reminders=1, relationship_score=100, historical_on_time_rate=0.9
    )
    three_reminders = predict_payment_probability(
        days_overdue=0, ignored_reminders=3, relationship_score=100, historical_on_time_rate=0.9
    )
    assert one_reminder["probability"] == 80  # 90 - 10
    assert three_reminders["probability"] == 60  # 90 - 30


def test_relationship_penalty_is_zero_at_and_above_the_50_midpoint():
    # max(0, (50 - relationship_score) * 0.3) — a client at exactly 50, or
    # anywhere above it, contributes nothing extra, never a bonus either.
    at_midpoint = predict_payment_probability(
        days_overdue=10, ignored_reminders=0, relationship_score=50, historical_on_time_rate=0.8
    )
    above_midpoint = predict_payment_probability(
        days_overdue=10, ignored_reminders=0, relationship_score=100, historical_on_time_rate=0.8
    )
    assert at_midpoint["probability"] == above_midpoint["probability"] == 75  # 80 - (10*0.5) - 0


def test_relationship_penalty_applies_below_the_50_midpoint():
    below_midpoint = predict_payment_probability(
        days_overdue=10, ignored_reminders=0, relationship_score=20, historical_on_time_rate=0.8
    )
    # 80 - (10*0.5) - ((50-20)*0.3) = 80 - 5 - 9 = 66
    assert below_midpoint["probability"] == 66


def test_a_realistic_mixed_invoice():
    result = predict_payment_probability(
        days_overdue=34, ignored_reminders=2, relationship_score=62, historical_on_time_rate=0.55
    )
    assert result["probability"] == 18


def test_explanation_mentions_the_actual_input_numbers():
    # The explanation string is shown to the person reviewing the draft —
    # it should be traceable back to the specific invoice, not generic.
    result = predict_payment_probability(
        days_overdue=15, ignored_reminders=2, relationship_score=40, historical_on_time_rate=0.7
    )
    assert "15 days overdue" in result["explanation"]
    assert "2 ignored reminders" in result["explanation"]
    assert "relationship score of 40" in result["explanation"]
