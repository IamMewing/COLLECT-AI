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
