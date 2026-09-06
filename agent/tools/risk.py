"""Risk scoring — ported from the original CollectAI riskEngine.js.

This is pure, deterministic Python (no model calls), so it's fast,
testable, and cheap to run on every invoice in a sweep. It's exposed
as a Strands @tool so the risk-assessment Agent can call it and reason
about the result rather than re-deriving the math itself.
"""

from strands import tool


@tool
def calculate_risk_score(
    days_overdue: int,
    amount: float,
    ignored_reminders: int,
    relationship_score: int,
) -> dict:
    """Calculate a 0-100 risk score for an overdue invoice.

    Args:
        days_overdue: Number of days past the due date.
        amount: Invoice amount in INR.
        ignored_reminders: Number of prior reminders this client has ignored.
        relationship_score: 0-100 relationship score (100 = excellent standing).

    Returns:
        dict with 'score' (0-100) and 'category' (Low/Medium/High/Critical).
    """
    score = 0.0
    score += min(days_overdue * 1.2, 40)                       # lateness: up to 40 pts
    score += min((amount / 200_000) * 20, 20)                  # exposure size: up to 20 pts
    score += min(ignored_reminders * 8, 25)                    # unresponsiveness: up to 25 pts
    score += max(0.0, (100 - relationship_score) / 100 * 15)   # relationship: up to 15 pts

    score = round(min(score, 100))

    if score >= 75:
        category = "Critical"
    elif score >= 50:
        category = "High"
    elif score >= 25:
        category = "Medium"
    else:
        category = "Low"

    return {"score": score, "category": category}
