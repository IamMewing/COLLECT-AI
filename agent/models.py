"""Structured output schemas for each graph node.

Using structured_output_model on the Strands Agents means every node
returns a validated Pydantic object instead of free text, so the
conditional edges in graph.py can branch on real fields (risk_category,
approved, etc.) instead of parsing prose.
"""

from typing import Literal
from pydantic import BaseModel, Field


class RiskAssessment(BaseModel):
    score: int = Field(ge=0, le=100, description="Risk score, higher = more likely to go unpaid")
    category: Literal["Low", "Medium", "High", "Critical"]
    reasoning: str


class ProbabilityAssessment(BaseModel):
    probability: int = Field(ge=0, le=100, description="Chance the invoice is paid without escalation")
    explanation: str


class ActionPlan(BaseModel):
    branch: Literal["standard", "escalation", "no_action"]
    channel: Literal["email", "whatsapp", "phone", "none"]
    tone: Literal["friendly", "firm", "urgent", "none"]
    reasoning: str


class DraftedMessage(BaseModel):
    subject: str
    body: str
    channel: Literal["email", "whatsapp"]


class Reflection(BaseModel):
    was_best_decision: bool
    suggested_tone_shift: str
    suggested_relationship_delta: int = Field(
        ge=-10, le=10, description="Adjustment to apply to the client's relationship score"
    )


class PlanInstallment(BaseModel):
    """One payment in a multi-installment plan the negotiate agent has
    actually committed to with the client (not just floated as an option).
    due_in_days is relative, not an absolute date, so the agent never has to
    know today's date — agent/execute.py converts it to a real due_at
    timestamp when the plan is persisted."""

    amount_usd: float = Field(gt=0)
    due_in_days: int = Field(ge=0, description="Days from now this installment is due. 0 = due now.")
    description: str = Field(description="Short label, e.g. 'Installment 1 of 3'")


class NegotiationTurn(BaseModel):
    """One decision in the autonomous negotiation loop (agent/execute.py's
    handle_incoming_reply): given the whole conversation so far plus the
    client's latest reply, decide whether to keep negotiating, consider the
    matter resolved, or hand it to a human."""

    outcome: Literal["continue_negotiating", "resolved", "escalate_to_human"]
    reply_subject: str | None = Field(
        default=None, description="Only set when outcome='continue_negotiating'"
    )
    reply_body: str | None = Field(
        default=None, description="Only set when outcome='continue_negotiating'"
    )
    proposed_plan: str | None = Field(
        default=None,
        description="Human-readable summary of any payment plan being offered, "
        "e.g. '3 installments of ₹20,000 starting Nov 15' — null if none.",
    )
    installments: list[PlanInstallment] | None = Field(
        default=None,
        description="Set ONLY when the client has actually agreed to a concrete "
        "multi-installment plan (2+ payments) right now — not while still "
        "discussing options. Each installment becomes a real, separately-tracked "
        "PayPal order billed automatically as it comes due.",
    )
    paypal_order_id: str | None = Field(
        default=None,
        description="If you called create_paypal_order this turn, copy the returned "
        "paypal_order_id here too, so it can be tracked against the right installment.",
    )
    payment_link: str | None = Field(
        default=None,
        description="If you called create_paypal_order this turn, copy the returned "
        "payment_link here too (in addition to weaving it into reply_body).",
    )
    reasoning: str
