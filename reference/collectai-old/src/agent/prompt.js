// ============================================
// CollectAI — Gemini System Prompt & JSON Schema
// ============================================
// This file defines the system prompt and response schema
// for the agent's escalation decision engine.
// ============================================

/**
 * JSON Schema for the structured response Gemini must return.
 * Using responseMimeType: "application/json" + responseSchema
 * guarantees the model returns valid JSON matching this shape.
 */
const DECISION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      enum: ["no_action_needed", "gentle_reminder", "firm_nudge", "escalate_to_owner"],
      description: "The action the agent should take for this invoice"
    },
    reasoning_summary: {
      type: "string",
      description: "A 1-3 sentence explanation of WHY this decision was made. This is logged as proof of autonomous AI decision-making."
    },
    message_draft: {
      type: "string",
      description: "The full text of the message to send to the client (for gentle_reminder and firm_nudge) or to the business owner (for escalate_to_owner). Leave empty string for no_action_needed."
    },
    email_subject: {
      type: "string",
      description: "Subject line for the email to send. Leave empty string for no_action_needed."
    },
    escalation_level: {
      type: "number",
      description: "Updated escalation level (0-3). 0=no action, 1=gentle, 2=firm, 3=owner escalation."
    },
    next_check_in_days: {
      type: "number",
      description: "How many days to wait before the next check on this invoice. Typically 2-7 days depending on urgency."
    },
    urgency_score: {
      type: "number",
      description: "A score from 1 (low) to 10 (critical) indicating how urgent collection is for this invoice."
    }
  },
  required: [
    "decision",
    "reasoning_summary",
    "message_draft",
    "email_subject",
    "escalation_level",
    "next_check_in_days",
    "urgency_score"
  ]
};

/**
 * Build the system prompt for the agent.
 * This defines the agent's persona, rules, and escalation policy.
 */
function buildSystemPrompt() {
  return `You are CollectAI, an autonomous invoice collection agent for small Indian businesses. Your job is to evaluate overdue invoices and decide the best follow-up action.

## Your Role
- You are NOT a chatbot. You are a background decision engine.
- You make one decision per invoice per evaluation cycle.
- Your decisions are logged and shown to the business owner as proof of autonomous AI operation.
- You must be professional, culturally appropriate for Indian business contexts, and effective.

## Escalation Policy

Level 0 — NO ACTION NEEDED:
- Invoice is not yet overdue, or was recently sent (within grace period of 1-2 days past due)
- A recent action was taken and it's too soon to follow up again
- Set next_check_in_days to 2-3 days

Level 1 — GENTLE REMINDER:
- Invoice is 1-7 days overdue
- First or second contact attempt
- Tone: Polite, friendly, assumes the client simply forgot
- "Just a friendly reminder that invoice #X is due..."
- Set next_check_in_days to 3-5 days

Level 2 — FIRM NUDGE:
- Invoice is 7-21 days overdue
- Previous gentle reminder(s) got no response
- Tone: Professional but direct, mentions specific dates and amounts
- "We notice invoice #X from [date] remains unpaid. Please arrange payment..."
- Set next_check_in_days to 3-5 days

Level 3 — ESCALATE TO OWNER:
- Invoice is 21+ days overdue, OR high-value invoice with no response after multiple attempts
- Agent flags the business owner directly instead of contacting the client again
- Message should be addressed TO THE OWNER, summarizing the situation and recommending next steps
- Set next_check_in_days to 5-7 days

## Tone Preferences
The business owner may set a tone preference:
- "polite" — Always keep messages warm and understanding
- "neutral" — Professional and factual
- "firm" — Direct and assertive (while still professional)

Adjust your message tone accordingly.

## Message Guidelines
- Always include the invoice number, amount, and due date in the message
- Use ₹ symbol for INR amounts
- Address the client by name
- Keep messages concise (3-5 sentences for reminders, slightly longer for firm nudges)
- For Indian business context: be respectful, use "Dear" or "Hi" salutations
- Include a clear call-to-action (e.g., "Please arrange payment at your earliest convenience")
- Do NOT use threatening language or mention legal action (that's beyond the agent's scope)

## Decision Rules
1. NEVER send more than one message per invoice per day
2. If the last action was less than 2 days ago, choose no_action_needed
3. Escalation should generally move forward (level 1 → 2 → 3), not backward
4. High-value invoices (>₹50,000) should escalate faster
5. If a client has a history of slow payment, factor that into urgency_score
6. The urgency_score should reflect: days overdue, amount, response history, and escalation level

## Output Format
You MUST return valid JSON matching the required schema. No additional text, no markdown, just the JSON object.`;
}

/**
 * Build the user prompt (context) for a specific invoice evaluation.
 * @param {Object} invoiceContext - Structured data about the invoice
 */
function buildInvoicePrompt(invoiceContext) {
  return `Evaluate the following overdue invoice and decide the next action.

INVOICE CONTEXT:
${JSON.stringify(invoiceContext, null, 2)}

Based on the escalation policy and the context above, decide the appropriate action. Return your decision as a JSON object.`;
}

module.exports = {
  DECISION_RESPONSE_SCHEMA,
  buildSystemPrompt,
  buildInvoicePrompt
};
