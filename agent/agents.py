"""Per-node Agent definitions.

Each Strands Graph node is an Agent (or nested MultiAgentBase) — not a
raw function — so every node here is a small, single-purpose Agent
with its own system prompt, tools, and structured_output_model. That
last part matters: structured_output_model makes each node return a
validated Pydantic object (see models.py) rather than free text, which
is what lets graph.py branch on real fields in its conditional edges.

Swap ANTHROPIC_API_KEY / MODEL_ID for Bedrock once Bedrock access is
unblocked — see get_model() below, it's the only place that changes.
"""

import os
from strands import Agent
from strands.models.anthropic import AnthropicModel

from .tools import calculate_risk_score, predict_payment_probability
from .models import RiskAssessment, ProbabilityAssessment, ActionPlan, DraftedMessage, Reflection, NegotiationTurn

MODEL_ID = os.environ.get("COLLECTAI_MODEL_ID", "claude-sonnet-4-6")


def get_model():
    """Model provider factory supporting Anthropic, Gemini, and Bedrock.

    Reads MODEL_PROVIDER env var (default: "anthropic"):
    - "anthropic": Anthropic-direct model provider (requires ANTHROPIC_API_KEY)
    - "gemini": Google Gemini model provider (requires GEMINI_API_KEY)
    - "bedrock": AWS Bedrock option (documented for when AgentCore access clears):
        from strands.models import BedrockModel
        return BedrockModel(model_id="anthropic.claude-sonnet-4-6...", region_name="us-east-1")

    Nothing else in this file or in graph.py needs to change — every
    node just calls get_model().
    """
    provider = os.environ.get("MODEL_PROVIDER", "anthropic").strip().lower()

    if provider == "gemini":
        from strands.models.gemini import GeminiModel
        return GeminiModel(
            client_args={"api_key": os.environ["GEMINI_API_KEY"].strip()},
            model_id=os.environ.get("COLLECTAI_MODEL_ID", "gemini-3.1-flash-lite").strip(),
        )
    elif provider == "anthropic":
        return AnthropicModel(
            client_args={"api_key": os.environ["ANTHROPIC_API_KEY"]},
            model_id=MODEL_ID,
            max_tokens=1024,
        )
    elif provider == "bedrock":
        raise NotImplementedError("Bedrock provider not yet configured — set MODEL_PROVIDER=gemini or MODEL_PROVIDER=anthropic")
    else:
        raise ValueError(f"Unknown MODEL_PROVIDER '{provider}'. Supported options: 'anthropic', 'gemini', 'bedrock'.")


from .retry import with_retry


def build_risk_agent():
    return with_retry(
        Agent(
            name="risk_assess",
            model=get_model(),
            tools=[calculate_risk_score],
            system_prompt=(
                "You assess collections risk for a single overdue invoice. "
                "You are given the invoice's days_overdue, amount, ignored_reminders, "
                "and relationship_score. Call calculate_risk_score with those exact "
                "values, then return the result as your structured output. Do not "
                "estimate the score yourself — always call the tool."
            ),
            structured_output_model=RiskAssessment,
        )
    )


def build_probability_agent():
    return with_retry(
        Agent(
            name="probability",
            model=get_model(),
            tools=[predict_payment_probability],
            system_prompt=(
                "You predict the probability an overdue invoice resolves without "
                "escalation. Call predict_payment_probability with the given "
                "days_overdue, ignored_reminders, relationship_score, and "
                "historical_on_time_rate, then return the result as structured output."
            ),
            structured_output_model=ProbabilityAssessment,
        )
    )


def build_plan_agent():
    return with_retry(
        Agent(
            name="plan",
            model=get_model(),
            system_prompt=(
                "You decide how to handle an overdue invoice given its risk category "
                "and payment probability (both provided above from earlier nodes). "
                "Rules: if probability >= 85, the invoice will likely resolve itself "
                "-> branch='no_action', channel='none', tone='none' (don't bother the "
                "client). If risk is Low/Medium and probability >= 50 -> "
                "branch='standard', tone='friendly', channel='email'. Otherwise -> "
                "branch='escalation', tone='firm' or 'urgent', channel='email' or "
                "'whatsapp' depending on urgency.\n\n"
                "If the invoice description includes a '[Persistent Client Memory]' "
                "block, you have chased this client before — read its recent history "
                "before deciding, don't just restate the risk/probability rule above. "
                "A client already logged as chased at least once, with no interaction "
                "showing the invoice was paid or resolved, has already demonstrated "
                "that a lighter touch didn't work on its own: lean toward "
                "branch='escalation' even where probability alone would suggest "
                "'standard', and pick a tone and channel firmer than whatever the most "
                "recent interaction's outcome line recommended — if that line already "
                "suggests a tone shift, that is your floor, not a ceiling. Conversely, "
                "a client with a strong memory (high relationship score, on-time "
                "history, no unresolved chases) can stay in 'standard' even at "
                "moderate risk — memory should make the agent more decisive in both "
                "directions, not just more aggressive. Always explain your reasoning "
                "briefly, and say explicitly when memory changed your decision from "
                "what risk/probability alone would have produced."
            ),
            structured_output_model=ActionPlan,
        )
    )


def build_draft_agent():
    return with_retry(
        Agent(
            name="draft",
            model=get_model(),
            system_prompt=(
                "You draft a short, human-sounding follow-up message to a client "
                "about an overdue invoice, matching the requested tone and channel. "
                "Never sound like a form letter or threaten legal action. Keep it "
                "under 120 words. Return subject, body, and channel as structured output. "
                "IMPORTANT: Never use bracketed placeholders such as [Your Name], [Name], "
                "[Company], or similar. Always sign off with 'The Accounts Team' — never "
                "leave any placeholder that would need to be filled in manually. "
                "ALWAYS end the body with its own final line, exactly this token and "
                "nothing else on that line: {{PAYMENT_LINK}} — this is a real payment "
                "link token that the execution layer substitutes with a live PayPal "
                "invoice link (or removes cleanly) before sending. Do not describe it, "
                "wrap it in extra words, or omit it."
            ),
            structured_output_model=DraftedMessage,
        )
    )


def build_negotiate_agent():
    """The autonomous negotiation loop's decision-maker (agent/execute.py's
    handle_incoming_reply). Given the whole conversation thread on one
    invoice plus the client's latest reply, this agent is the one actually
    reading what the client wrote and deciding what happens next — not a
    human re-prompting the system each round. It can keep going (and write
    the next reply itself), consider the matter resolved, or recognize when
    something needs a human."""
    return with_retry(
        Agent(
            name="negotiate",
            model=get_model(),
            system_prompt=(
                "You are continuing a real email conversation with a client about an "
                "overdue invoice, on behalf of the accounts team. You're given the full "
                "thread so far (oldest first) ending with the client's latest message. "
                "Decide one of three outcomes:\n\n"
                "1. outcome='resolved' — the client has clearly agreed to pay (in full or "
                "via a plan you already proposed) or confirms payment is already made. "
                "Leave reply_subject/reply_body empty.\n"
                "2. outcome='escalate_to_human' — the client disputes the invoice, raises "
                "something you shouldn't decide alone (legal threats, a complaint about "
                "the business, a request for a discount/write-off, confusion you can't "
                "resolve from the thread alone), or is hostile. Leave reply_subject/"
                "reply_body empty — a person will take it from here.\n"
                "3. outcome='continue_negotiating' — anything else. Write the next reply "
                "yourself: reply_subject and reply_body, matching a professional but "
                "human tone, under 120 words, no bracketed placeholders, signed off as "
                "'The Accounts Team'. If the client is asking for more time or can't pay "
                "the full amount at once, propose a concrete installment plan (describe "
                "it in both reply_body and proposed_plan) rather than just repeating the "
                "original ask — a plan the client might actually accept is the point of "
                "this conversation continuing at all.\n\n"
                "IMPORTANT: reply_subject must end with the exact same '[INV-XXXX]' tag "
                "that appears in the thread's subject lines — this is how later replies "
                "get matched back to this conversation. Never drop or alter that tag.\n\n"
                "Always explain your reasoning briefly in the reasoning field."
            ),
            structured_output_model=NegotiationTurn,
        )
    )


def build_reflect_agent():
    return with_retry(
        Agent(
            name="reflect",
            model=get_model(),
            system_prompt=(
                "You review the outcome of a collections action that was already "
                "taken (approved, sent, and — if known — the client's response). "
                "Decide whether it was the best decision, suggest a tone shift for "
                "next time with this client if warranted, and suggest a relationship "
                "score delta (-10 to +10). Return this as structured output."
            ),
            structured_output_model=Reflection,
        )
    )

