"""Payment probability — ported from the original CollectAI probabilityEngine.js.

Also pure Python. Risk asks "how bad could this get"; this asks
"how likely is it to resolve itself without escalation" — the two
scores together are what let the graph route calmly-recoverable
invoices down the standard path and route the rest to escalation.
"""

from strands import tool


@tool
def predict_payment_probability(
    days_overdue: int,
    ignored_reminders: int,
    relationship_score: int,
    historical_on_time_rate: float,
) -> dict:
    """Predict the probability an invoice gets paid without escalation.

    Args:
        days_overdue: Number of days past due.
        ignored_reminders: Number of reminders this client has ignored so far.
        relationship_score: 0-100 relationship score.
        historical_on_time_rate: 0.0-1.0, fraction of this client's past invoices paid on time.

    Returns:
        dict with 'probability' (0-100) and 'explanation'.
    """
    base = historical_on_time_rate * 100
    penalty = (days_overdue * 0.5) + (ignored_reminders * 10) + max(0.0, (50 - relationship_score) * 0.3)
    probability = round(max(0, min(100, base - penalty)))

    explanation = (
        f"Base rate from this client's history: {base:.0f}%. "
        f"Reduced by {penalty:.0f} points for {days_overdue} days overdue, "
        f"{ignored_reminders} ignored reminders, and a relationship score of {relationship_score}."
    )
    return {"probability": probability, "explanation": explanation}
