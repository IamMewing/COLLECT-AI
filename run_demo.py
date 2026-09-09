"""Run one invoice through the full CollectAI sweep, end to end.

Real mode (needs a funded ANTHROPIC_API_KEY or working Bedrock access):
    export ANTHROPIC_API_KEY=sk-ant-...
    python run_demo.py

Mock mode (zero API calls, zero cost — use this while you have no
credits or are waiting on Bedrock access):
    python run_demo.py --mock

Mock mode exercises the exact same data shapes (RiskAssessment,
ActionPlan, DraftedMessage, etc.) as the real graph, so your frontend,
Approval Gate UI, and Express routes can all be built and tested
against it today — swapping to --mock off later needs zero changes
downstream.
"""

import os
import sys
from agent import run_sweep, approve_and_execute, mock_run_sweep, mock_approve_and_execute

MOCK = "--mock" in sys.argv

# Seed invoice — swap for a real Firestore doc once you're pulling live data.
INVOICE = {
    "invoice_id": "INV-1042",
    "client_name": "Meridian Design Co.",
    "amount": 185000,
    "days_overdue": 34,
    "ignored_reminders": 2,
    "relationship_score": 62,
    "historical_on_time_rate": 0.55,
}

INVOICE_TASK = f"""
Invoice #{INVOICE['invoice_id']} for client "{INVOICE['client_name']}"
- Amount: INR {INVOICE['amount']}
- Days overdue: {INVOICE['days_overdue']}
- Ignored reminders so far: {INVOICE['ignored_reminders']}
- Client relationship score: {INVOICE['relationship_score']} (out of 100)
- Historical on-time payment rate for this client: {INVOICE['historical_on_time_rate']} (55%)

Assess this invoice's risk, predict the payment probability, decide
on an action plan, and (if warranted) draft a follow-up message.
"""


def main():
    if MOCK:
        print("=== MOCK MODE — zero API calls, zero cost ===\n")
        result = mock_run_sweep(INVOICE)
        print(f"Risk: {result['risk']}")
        print(f"Probability: {result['probability']}")
        print(f"Plan: {result['plan']}\n")

        if result["draft"] is None:
            print("No draft produced — plan chose branch='no_action'.")
            return

        drafted_message = result["draft"]
        print("=== DRAFTED MESSAGE (awaiting human approval) ===")
        print(f"Channel: {drafted_message.channel}")
        print(f"Subject: {drafted_message.subject}")
        print(drafted_message.body)
        print()

        outcome = mock_approve_and_execute(drafted_message, approved=True)
        print("=== EXECUTION + REFLECTION ===")
        print(outcome)
        return

    provider = os.environ.get("MODEL_PROVIDER", "anthropic").strip().lower()
    default_model = "claude-sonnet-4-6" if provider == "anthropic" else ("gemini-3.1-flash-lite" if provider == "gemini" else "default")
    model_name = os.environ.get("COLLECTAI_MODEL_ID", default_model)
    print(f"Running sweep for one invoice (real {provider.capitalize()} [{model_name}] calls)...\n")
    result = run_sweep(INVOICE_TASK)

    print(f"Graph status: {result.status}")

    draft_result = result.results.get("draft")
    if draft_result is None:
        plan_result = result.results.get("plan")
        print("No draft produced — plan node likely chose branch='no_action'.")
        if plan_result:
            print(f"Plan reasoning: {plan_result.result.structured_output}")
        return

    drafted_message = draft_result.result.structured_output
    print("=== DRAFTED MESSAGE (awaiting human approval) ===")
    print(f"Channel: {drafted_message.channel}")
    print(f"Subject: {drafted_message.subject}")
    print(drafted_message.body)
    print()

    outcome = approve_and_execute(drafted_message, approved=True)
    print("=== EXECUTION + REFLECTION ===")
    print(outcome)


if __name__ == "__main__":
    main()

