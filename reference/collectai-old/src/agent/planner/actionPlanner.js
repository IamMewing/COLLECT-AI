// ============================================
// CollectAI — Action Planner
// ============================================

/**
 * Parses Gemini reasoning outputs and compiles a sequential list of steps 
 * detailing execution parameters (Email notifications, Ledger status updates, Reflections).
 */
function generateActionPlan(reasoningResult, invoiceId, userId) {
  const steps = [];

  const { decision, messageDraft, emailSubject, recommendedChannel, nextCheckInDays } = reasoningResult;

  // Step 1: Message generation and Dispatching
  if (decision !== 'no_action_needed') {
    if (recommendedChannel === 'email' || recommendedChannel === 'both') {
      steps.push({
        id: 'dispatch_email',
        title: 'Dispatch Client Recovery Email',
        description: `Deliver email message to client. Subject: ${emailSubject}`,
        status: 'pending',
        type: 'communication',
        params: {
          channel: 'email',
          subject: emailSubject,
          body: messageDraft
        }
      });
    }

    if (recommendedChannel === 'whatsapp' || recommendedChannel === 'both') {
      steps.push({
        id: 'dispatch_whatsapp',
        title: 'Dispatch WhatsApp Message',
        description: 'Send direct WhatsApp message placeholder to client contact phone.',
        status: 'pending',
        type: 'communication',
        params: {
          channel: 'whatsapp',
          body: messageDraft
        }
      });
    }

    if (decision === 'call_owner' || decision === 'escalate') {
      steps.push({
        id: 'notify_owner',
        title: 'Notify Studio Owner',
        description: 'Escalate recovery timeline to business owner for personal follow-up.',
        status: 'pending',
        type: 'notification',
        params: {
          escalation: true,
          subject: emailSubject,
          body: messageDraft
        }
      });
    }
  }

  // Step 2: Database / Ledger update
  steps.push({
    id: 'update_ledger',
    title: 'Update Invoices Ledger Status',
    description: `Advance escalation intervals and set next check-date in ${nextCheckInDays} days.`,
    status: 'pending',
    type: 'database',
    params: {
      nextCheckInDays,
      decision
    }
  });

  // Step 3: Reflection update
  steps.push({
    id: 'write_reflection',
    title: 'Register Action Reflection Metric',
    description: 'Post-action analysis logging performance indicators, expected recovery rates, and tone changes.',
    status: 'pending',
    type: 'reflection',
    params: {
      reasoningResult
    }
  });

  // Step 4: Customer Memory update
  steps.push({
    id: 'update_customer_memory',
    title: 'Update Client Memory Statistics',
    description: 'Recalculate credit risk, trust indexes, average delays, and sent counts.',
    status: 'pending',
    type: 'memory',
    params: {
      decision
    }
  });

  return {
    invoiceId,
    userId,
    planId: 'plan_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    steps
  };
}

module.exports = { generateActionPlan };
