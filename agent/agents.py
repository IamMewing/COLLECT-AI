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

from .tools import calculate_risk_score, predict_payment_probability, create_paypal_order, get_paypal_order_status
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
            model_id=os.environ.get("COLLECTAI_MODEL_ID", "gemini-3.5-flash-lite").strip(),
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
                "branch='standard', tone='friendly', channel='email' if email is on file "
                "(prefer it for a low-urgency touch), else channel='whatsapp' if only a "
                "phone is on file. Otherwise -> branch='escalation', tone='firm' or "
                "'urgent', channel='whatsapp' if a phone is on file (an urgent nudge is "
                "more likely to actually be seen there than in an inbox), else "
                "channel='email'.\n\n"
                "CHANNEL AVAILABILITY IS NOT A PREFERENCE, IT'S A FACT: the invoice "
                "description tells you which contact methods are actually on file "
                "('Email on file: yes/no', 'Phone on file: yes/no'). Never choose "
                "channel='whatsapp' when phone on file is 'no' — there's no number to "
                "send to, and the message would simply never arrive. If neither is on "
                "file, always fall back to channel='email' regardless of urgency. Only "
                "choose channel='sms' if explicitly told elsewhere that SMS is available "
                "for this invoice — by default this project has no SMS provider "
                "configured, only WhatsApp and email.\n\n"
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
                "under 120 words for channel='email' or 'whatsapp'. For channel='sms', "
                "be much more terse — under 300 characters total, one short paragraph, "
                "no greeting/sign-off ceremony — SMS is read as a text message, not a "
                "letter. Return subject, body, and channel as structured output (subject "
                "is still required even for whatsapp/sms — it's used for the internal "
                "record, not shown to the client on those channels). "
                "IMPORTANT: Never use bracketed placeholders such as [Your Name], [Name], "
                "[Company], or similar. For email/whatsapp, always sign off with 'The "
                "Accounts Team'; for sms, skip the sign-off entirely to save space. Never "
                "leave any placeholder that would need to be filled in manually. "
                "ALWAYS include this exact token on its own line (email/whatsapp) or "
                "inline in the final sentence (sms, to save space): {{PAYMENT_LINK}} — "
                "this is a real payment link token that the execution layer substitutes "
                "with a live PayPal invoice link (or removes cleanly) before sending. Do "
                "not describe it, wrap it in extra words, or omit it."
            ),
            structured_output_model=DraftedMessage,
        )
    )


def build_negotiate_agent():
    """The autonomous negotiation loop's decision-maker — shared by
    agent/execute.py's handle_incoming_reply (email/WhatsApp/SMS replies)
    and handle_voice_turn (live Twilio Voice calls). Given the whole
    conversation thread on one invoice plus the client's latest reply (or,
    on a phone call's opening turn, the fact that there's no reply yet
    because the agent is the one placing the call), this agent is the one
    actually deciding what happens next — not a human re-prompting the
    system each round. It can keep going (and write the next reply/line
    itself), consider the matter resolved, or recognize when something
    needs a human."""
    return with_retry(
        Agent(
            name="negotiate",
            model=get_model(),
            tools=[create_paypal_order, get_paypal_order_status],
            system_prompt=(
                "You are continuing a real conversation with a client about an overdue "
                "invoice, on behalf of the accounts team — over email, WhatsApp, SMS, or "
                "a live phone call; each turn in the thread below is labeled with which "
                "channel it happened on, and the client's latest message is always the "
                "last turn (unless the context tells you that you're the one placing a "
                "call right now and the client hasn't said anything yet — see the phone "
                "note below). You're given the full thread so far (oldest first), "
                "including the invoice id and client name. Decide one of three "
                "outcomes:\n\n"
                "1. outcome='resolved' — the client has clearly agreed to pay (in full or "
                "via a plan you already proposed) or confirms payment is already made. "
                "On a phone call, still write a brief one-sentence spoken sign-off in "
                "reply_body (e.g. 'Great, thanks — that's all I needed, have a good day.') "
                "since you can't just go silent on a live call; on every other channel "
                "leave reply_subject/reply_body empty.\n"
                "2. outcome='escalate_to_human' — the client disputes the invoice, raises "
                "something you shouldn't decide alone (legal threats, a complaint about "
                "the business, a request for a discount/write-off, confusion you can't "
                "resolve from the thread alone), or is hostile. On a phone call, still "
                "write a brief spoken line handing off gracefully (e.g. 'I'll have someone "
                "from our team follow up with you directly on this.'); on every other "
                "channel leave reply_subject/reply_body empty — a person takes it from "
                "here.\n"
                "3. outcome='continue_negotiating' — anything else. Write the next reply "
                "yourself in reply_body, replying on the SAME channel the client's latest "
                "message came in on (never switch channels mid-thread on your own). For "
                "email, match a professional but human tone, under 120 words, signed off "
                "as 'The Accounts Team', and fill reply_subject (see the tagging rule "
                "below). For whatsapp, same tone and length, but no sign-off needed and "
                "reply_subject can be left empty — it isn't shown to the client there. For "
                "sms, be terse: under 300 characters, one short paragraph, no greeting or "
                "sign-off, reply_subject empty. For a phone call, write exactly what you'd "
                "say out loud: 1-3 short sentences, plain conversational language, no "
                "markdown, no sign-off, reply_subject empty — this gets read aloud by "
                "text-to-speech, so long sentences or lists are unusable. No bracketed "
                "placeholders on any channel. If the client is asking for more time or "
                "can't pay the full amount at once, propose a concrete installment plan "
                "(describe it in both reply_body and proposed_plan) rather than just "
                "repeating the original ask — a plan the client might actually accept is "
                "the point of this conversation continuing at all.\n\n"
                "PHONE CALLS SPECIFICALLY: when the context tells you that you are the "
                "one placing this call and the client hasn't said anything yet, that's "
                "your opening turn — introduce yourself briefly (calling from the accounts "
                "team about an overdue invoice), state the reason for the call in 1-2 "
                "short spoken sentences, and stop there (outcome='continue_negotiating') "
                "so the client can respond; don't try to resolve anything on the opening "
                "turn itself. On every phone turn, NEVER say a URL or payment link out "
                "loud — it's unusable spoken aloud. If you mint a payment link this turn "
                "(see below), say something like 'I'll text that link to you right now' "
                "in reply_body instead of reciting it; the system sends the real text "
                "automatically whenever payment_link is filled in on a phone turn, so "
                "that promise is always true.\n\n"
                "USING THE PAYPAL TOOLS: the moment you and the client land on a specific "
                "number you're both ready to act on right now — the full balance, a "
                "negotiated settlement, or the first installment of a plan — call "
                "create_paypal_order yourself with that exact amount (convert to USD; "
                "assume 83 INR per USD if the thread is in INR) to mint a real, payable "
                "link. On email/whatsapp/sms, weave the returned payment_link directly "
                "into reply_body (e.g. 'Pay instantly via PayPal: <link>') — don't just "
                "promise a link in words, generate the real one and include it. On a "
                "phone call, do NOT put the link in reply_body (see above) — just say "
                "you're texting it. Either way, copy that same paypal_order_id and "
                "payment_link into this turn's own paypal_order_id/payment_link fields "
                "too (not just into reply_body) — that's how the system tracks which "
                "order belongs to which installment, and on phone calls it's also how the "
                "real text actually gets sent. Only do this once an amount is actually "
                "agreed, not while still discussing options. Use get_paypal_order_status "
                "if you need to check whether a link you sent earlier in this thread was "
                "already acted on before replying again.\n\n"
                "MULTI-INSTALLMENT PLANS: if the client has just agreed to pay in more "
                "than one installment (not merely asked about the idea), fill in the "
                "installments field with every installment in the plan, in order, each "
                "with its own amount_usd and due_in_days (0 for the first one if it's due "
                "now). The system bills each later installment automatically as it comes "
                "due and emails the client a fresh real payment link then — you don't "
                "need to create orders for anything beyond what's due right now. Leave "
                "installments unset for a single lump-sum agreement or while still "
                "discussing options.\n\n"
                "IMPORTANT (email only): reply_subject must end with the exact same "
                "'[INV-XXXX]' tag that appears in the thread's subject lines — this is how "
                "later email replies get matched back to this conversation. Never drop or "
                "alter that tag. (WhatsApp/SMS/phone threads are matched by phone number "
                "instead, so this doesn't apply there — leave reply_subject empty.)\n\n"
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



def build_assistant_agent():
    """The floating assistant in the UI — answers questions about the
    portfolio in plain language.

    Deliberately tool-less and free-text, unlike every other agent here:
    those exist to produce one validated Pydantic object that the graph then
    routes on, whereas this one is read-only and conversational, and
    structured output would just get in the way of a sentence. It is given
    the real ledger, history and negotiation state as context by the caller
    (server/agent_bridge.py's handle_assistant), so it answers from this
    deployment's actual data rather than from anything it's inferred.
    """
    return with_retry(
        Agent(
            name="assistant",
            model=get_model(),
            system_prompt=(
                "You are the assistant inside CollectAI, an autonomous invoice-"
                "collections tool. You help the person who runs it understand what's "
                "happening across their accounts.\n\n"
                "You are given a snapshot of their real data — invoices with amounts, "
                "how overdue each is, status, the messages the agent has sent, and any "
                "live negotiation threads. Answer only from that snapshot.\n\n"
                "Rules:\n"
                "- If the snapshot doesn't contain the answer, say so plainly. Never "
                "invent an invoice, a client, an amount, or an event.\n"
                "- Amounts are in INR. Write them as ₹1,20,000 (Indian digit grouping).\n"
                "- Be concise: two or three sentences for most questions. Use a short "
                "list only when genuinely listing several accounts.\n"
                "- You cannot take actions — you can't send messages, mark things paid, "
                "or run the agent. If asked to do something, explain where in the app "
                "they can do it (the ledger runs the agent, the approval gate sends).\n"
                "- Plain prose, no markdown headers, no preamble like 'Based on the data'."
            ),
        )
    )
