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
    reasoning: str
