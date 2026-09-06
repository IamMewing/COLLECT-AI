// ============================================
// CollectAI — Gemini Reasoning Engine
// ============================================

const { getGeminiClient, GEMINI_MODEL } = require('../../config/gemini');
const { getDecisionPrompt } = require('../prompts/promptLibrary');

/**
 * JSON schema detailing the structured AI reasoning and predictions output.
 */
const DECISION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    decision: { 
      type: "string", 
      enum: [
        "no_action_needed", 
        "gentle_reminder", 
        "friendly_reminder", 
        "professional_reminder", 
        "urgent_reminder", 
        "whatsapp_message", 
        "email", 
        "both", 
        "call_owner", 
        "escalate", 
        "offer_payment_plan", 
        "pause_communication", 
        "mark_high_risk", 
        "mark_vip", 
        "request_human_review", 
        "generate_followup_schedule"
      ] 
    },
    confidence: { type: "number" },
    urgency: { type: "number" },
    risk: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
    recommendedChannel: { type: "string", enum: ["email", "whatsapp", "both"] },
    suggestedTime: { type: "string" },
    messageTone: { type: "string", enum: ["polite", "neutral", "firm"] },
    whyThisDecision: { type: "string" },
    futurePrediction: { type: "string" },
    expectedPaymentProbability: { type: "number" },
    messageDraft: { type: "string" },
    emailSubject: { type: "string" },
    nextCheckInDays: { type: "number" }
  },
  required: [
    "reasoning", "decision", "confidence", "urgency", "risk", 
    "recommendedChannel", "suggestedTime", "messageTone", 
    "whyThisDecision", "futurePrediction", "expectedPaymentProbability", 
    "messageDraft", "emailSubject", "nextCheckInDays"
  ]
};

/**
 * Runs the Gemini model using the consolidated context library.
 * Gracefully defaults to deterministic fallback rules if Gemini fails.
 */
async function runGeminiReasoning(context) {
  const ai = getGeminiClient();
  const prompt = getDecisionPrompt(context);

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: "You are the CollectAI autonomous decision system. You must output JSON aligning precisely with the required schema.",
          responseMimeType: "application/json",
          responseSchema: DECISION_OUTPUT_SCHEMA,
          temperature: 0.2
        }
      });

      const data = JSON.parse(response.text);
      return { source: 'gemini', ...data };
    } catch (error) {
      console.warn("⚠️ Gemini reasoning API invocation failed:", error.message);
    }
  }

  // Graceful rule-based sandbox fallback
  return getFallbackReasoning(context);
}

/**
 * Procedural fallback logic if the Gemini client is disconnected.
 */
function getFallbackReasoning(ctx) {
  const daysOverdue = ctx.daysOverdue;
  const isVip = ctx.clientMemory?.relationshipScore > 90;
  
  let decision = 'gentle_reminder';
  let tone = 'polite';
  let probability = 85;
  let risk = 'Low';
  let urgency = 3;
  let nextCheck = 3;

  let reasoning = `Evaluating overdue invoice for client ${ctx.invoice.clientName}.`;
  let subject = `Payment Reminder: Invoice #${ctx.invoice.invoice_id} from ${ctx.business.name}`;
  let draft = `Dear ${ctx.invoice.clientName},\n\nThis is a friendly reminder that Invoice #${ctx.invoice.invoice_id} for ₹${ctx.invoice.amount.toLocaleString('en-IN')} was due on ${ctx.invoice.dueDate}.\n\nBest regards,\n${ctx.business.name}`;

  if (daysOverdue > 21) {
    decision = 'escalate';
    tone = 'firm';
    probability = 30;
    risk = 'High';
    urgency = 9;
    nextCheck = 5;
    reasoning += ` Days overdue (${daysOverdue}) exceeds high threshold.`;
    subject = `⚠️ URGENT: Overdue Account Escalation (Invoice #${ctx.invoice.invoice_id})`;
    draft = `Dear ${ctx.invoice.clientName},\n\nWe have reached out multiple times regarding Invoice #${ctx.invoice.invoice_id} (₹${ctx.invoice.amount.toLocaleString('en-IN')}). Your payment is now severely overdue. Please process this payment immediately.\n\nSincerely,\n${ctx.business.name}`;
  } else if (daysOverdue > 7) {
    decision = 'professional_reminder';
    tone = 'neutral';
    probability = 65;
    risk = 'Medium';
    urgency = 6;
    nextCheck = 3;
    reasoning += ` Days overdue (${daysOverdue}) calls for professional follow-up.`;
    subject = `Overdue Payment Notice: Invoice #${ctx.invoice.invoice_id}`;
    draft = `Dear ${ctx.invoice.clientName},\n\nWe note that Invoice #${ctx.invoice.invoice_id} for ₹${ctx.invoice.amount.toLocaleString('en-IN')} remains unpaid. Please settle this outstanding balance at your earliest convenience.\n\nThank you,\n${ctx.business.name}`;
  }

  if (isVip) {
    decision = 'gentle_reminder';
    tone = 'polite';
    probability = 95;
    risk = 'Low';
    urgency = 2;
    reasoning += ' Client relationship score is high; handling as VIP.';
  }

  return {
    source: 'fallback_engine',
    reasoning,
    decision,
    confidence: 90,
    urgency,
    risk,
    recommendedChannel: 'email',
    suggestedTime: '09:30 AM',
    messageTone: tone,
    whyThisDecision: reasoning,
    futurePrediction: `Client is expected to clear the invoice within ${nextCheck} days.`,
    expectedPaymentProbability: probability,
    messageDraft: draft,
    emailSubject: subject,
    nextCheckInDays: nextCheck
  };
}

module.exports = { runGeminiReasoning };
