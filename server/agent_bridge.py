#!/usr/bin/env python3
"""Bridge script between Express server and Python Strands Agent.

Accepts JSON via stdin:
{
    "action": "sweep" | "approve",
    "payload": { ... }
}

Outputs JSON via stdout on success. Any errors or stack traces are written to stderr.
"""

import sys
import os
import json
from pathlib import Path

# Ensure root directory is in sys.path so 'agent' can be imported
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Toggle between mock and real agent runs.
# The user can swap this to False once API access is unblocked.
USE_MOCK = os.environ.get("COLLECT_AI_MOCK", "true").lower() == "true"

from agent import (
    mock_run_sweep,
    mock_approve_and_execute,
    DraftedMessage,
)

# If real mode is enabled in the future:
if not USE_MOCK:
    from agent import run_sweep, approve_and_execute


def handle_sweep(payload: dict) -> dict:
    invoice = payload.get("invoice")
    if not invoice:
        raise ValueError("Missing 'invoice' in sweep payload")

    # Required fields validation for mock_run_sweep
    required_keys = ["days_overdue", "amount", "ignored_reminders", "relationship_score", "historical_on_time_rate"]
    missing = [k for k in required_keys if k not in invoice]
    if missing:
        raise ValueError(f"Invoice missing required fields: {', '.join(missing)}")

    # Ensure correct numerical types
    clean_invoice = {
        "invoice_id": str(invoice.get("invoice_id", "INV-UNKNOWN")),
        "client_name": str(invoice.get("client_name", "Valued Client")),
        "amount": float(invoice["amount"]),
        "days_overdue": int(invoice["days_overdue"]),
        "ignored_reminders": int(invoice["ignored_reminders"]),
        "relationship_score": int(invoice["relationship_score"]),
        "historical_on_time_rate": float(invoice["historical_on_time_rate"]),
    }

    if USE_MOCK:
        result = mock_run_sweep(clean_invoice)
    else:
        # For real Strands Agent graph
        task = (
            f"Invoice #{clean_invoice['invoice_id']} for client \"{clean_invoice['client_name']}\"\n"
            f"- Amount: INR {clean_invoice['amount']}\n"
            f"- Days overdue: {clean_invoice['days_overdue']}\n"
            f"- Ignored reminders so far: {clean_invoice['ignored_reminders']}\n"
            f"- Client relationship score: {clean_invoice['relationship_score']} (out of 100)\n"
            f"- Historical on-time payment rate: {clean_invoice['historical_on_time_rate']}\n\n"
            f"Assess this invoice's risk, predict payment probability, decide action plan, and draft message if warranted."
        )
        graph_result = run_sweep(task)
        # Extract structured outputs
        risk = graph_result.results.get("risk_assess")
        prob = graph_result.results.get("probability")
        plan = graph_result.results.get("plan")
        draft = graph_result.results.get("draft")
        result = {
            "risk": risk.result.structured_output if risk else None,
            "probability": prob.result.structured_output if prob else None,
            "plan": plan.result.structured_output if plan else None,
            "draft": draft.result.structured_output if draft else None,
        }

    # Serialize pydantic models to dicts
    serialized = {
        "invoice": clean_invoice,
        "risk": result["risk"].model_dump() if result.get("risk") else None,
        "probability": result["probability"].model_dump() if result.get("probability") else None,
        "plan": result["plan"].model_dump() if result.get("plan") else None,
        "draft": result["draft"].model_dump() if result.get("draft") else None,
    }
    return serialized


def handle_approve(payload: dict) -> dict:
    draft_data = payload.get("draft")
    approved = bool(payload.get("approved", False))
    edited_body = payload.get("edited_body")

    if not draft_data:
        raise ValueError("Missing 'draft' in approve payload")

    # If body was edited, override it
    if edited_body:
        draft_data["body"] = edited_body

    draft = DraftedMessage(
        subject=draft_data["subject"],
        body=draft_data["body"],
        channel=draft_data.get("channel", "email"),
    )

    if USE_MOCK:
        outcome = mock_approve_and_execute(draft=draft, approved=approved)
    else:
        outcome = approve_and_execute(message=draft, approved=approved, edited_body=edited_body)

    # Serialize outcome
    serialized_outcome = {
        "status": outcome.get("status"),
        "reason": outcome.get("reason"),
        "channel": draft.channel,
        "subject": draft.subject,
        "final_body": draft.body,
    }

    if "reflection" in outcome and outcome["reflection"]:
        reflection = outcome["reflection"]
        serialized_outcome["reflection"] = reflection.model_dump() if hasattr(reflection, "model_dump") else reflection

    if "send_result" in outcome:
        serialized_outcome["send_result"] = outcome["send_result"]

    return serialized_outcome


def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValueError("No input received on stdin")

        request = json.loads(raw_input)
        action = request.get("action")
        payload = request.get("payload", {})

        # Redirect stdout during mock/agent calls so any print() statements (like "[MOCK SEND...]")
        # go to stderr/logs and don't corrupt stdout JSON.
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            if action == "sweep":
                res = handle_sweep(payload)
            elif action == "approve":
                res = handle_approve(payload)
            else:
                raise ValueError(f"Unknown action '{action}'. Valid actions are 'sweep' and 'approve'.")

        json.dump(res, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        # Write exact error message and traceback to stderr so Express can capture it
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
