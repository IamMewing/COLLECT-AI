// ============================================
// CollectAI — Execution Engine
// ============================================

const { sendFollowUpEmail, sendOwnerEscalation } = require('../../services/emailService');
const { writeAgentReflection } = require('../reflection/reflectionEngine');
const { updateClientMemory, getClientMemory } = require('../memory/clientMemory');
const { calculateRiskScore } = require('../risk/riskEngine');
const { COLLECTIONS } = require('../../config/firebase');

/**
 * Sequential execution of action plans.
 * Evaluates each step status and writes results to activity logs.
 */
async function executeActionPlan(db, actionPlan, context) {
  const { invoiceId, userId, planId, steps } = actionPlan;
  const executionLogs = [];

  const invoice = context.invoice;
  const clientName = invoice.clientName;
  const clientEmail = invoice.clientEmail;

  console.log(`\n⚙️  Executing Action Plan ${planId} for Invoice #${invoiceId}`);

  for (const step of steps) {
    step.started_at = new Date();
    try {
      console.log(`   ⚙️  Executing Step: ${step.title}`);

      switch (step.id) {
        case 'dispatch_email':
          if (clientEmail) {
            const result = await sendFollowUpEmail({
              to: clientEmail,
              subject: step.params.subject,
              body: step.params.body
            });
            step.status = result.success ? 'completed' : 'failed';
            step.result = result;
          } else {
            console.log(`   ⚠️ Skipping email send: Client email undefined.`);
            step.status = 'skipped';
          }
          break;

        case 'dispatch_whatsapp':
          // Simulated WhatsApp message dispatch
          console.log(`   💬 [SIMULATED WHATSAPP] sending reminder to ${clientName}`);
          step.status = 'completed';
          step.result = { success: true, messageId: 'wa_msg_mock_123' };
          break;

        case 'notify_owner':
          if (context.business?.email) {
            const result = await sendOwnerEscalation({
              ownerEmail: context.business.email,
              invoiceId: invoice.invoice_id || invoiceId,
              clientName: clientName,
              amount: invoice.amount,
              currency: invoice.currency,
              daysOverdue: context.daysOverdue,
              reasoning: step.params.body
            });
            step.status = result.success ? 'completed' : 'failed';
            step.result = result;
          } else {
            step.status = 'skipped';
          }
          break;

        case 'update_ledger':
          const nextCheckDate = new Date();
          nextCheckDate.setDate(nextCheckDate.getDate() + (step.params.nextCheckInDays || 3));

          const updates = {
            last_action_at: new Date(),
            next_check_date: nextCheckDate
          };

          // Adjust status on owner escalations
          if (step.params.decision === 'escalate' || step.params.decision === 'call_owner') {
            updates.status = 'escalated';
            updates.escalation_level = 3;
          } else if (step.params.decision.includes('reminder')) {
            updates.escalation_level = Math.min(2, (invoice.escalationLevel || 0) + 1);
          }

          await db.collection(COLLECTIONS.INVOICES).doc(invoiceId).update(updates);
          step.status = 'completed';
          step.result = { success: true, updates };
          break;

        case 'write_reflection':
          const actionLog = {
            invoiceId,
            userId,
            decision: step.params.reasoningResult.decision,
            reasoning: step.params.reasoningResult.reasoning,
            urgencyScore: step.params.reasoningResult.urgency,
            channel: step.params.reasoningResult.recommendedChannel,
            timestamp: new Date()
          };

          const reflection = await writeAgentReflection(db, actionLog, step.params.reasoningResult, userId);
          step.status = 'completed';
          step.result = { success: true, reflectionId: reflection.id };
          break;

        case 'update_customer_memory':
          // Recalculate client statistics based on action results
          const clientMem = await getClientMemory(db, clientName, userId);
          
          let trust = clientMem.trustScore;
          let rel = clientMem.relationshipScore;
          let ignored = clientMem.ignoredReminders;
          
          if (step.params.decision === 'escalate') {
            trust = Math.max(10, trust - 15);
            rel = Math.max(10, rel - 10);
            ignored += 1;
          } else if (step.params.decision.includes('reminder')) {
            trust = Math.max(20, trust - 3);
          }

          // Calculate updated risk score
          const riskDetails = calculateRiskScore(daysOverdue = context.daysOverdue, invoice.amount, ignored, rel);

          await updateClientMemory(db, clientName, userId, {
            trustScore: trust,
            relationshipScore: rel,
            riskScore: riskDetails.score,
            ignoredReminders: ignored,
            totalInvoices: (clientMem.totalInvoices || 0) + 1,
            lastInteractionDate: new Date()
          });

          step.status = 'completed';
          break;

        default:
          step.status = 'skipped';
      }
    } catch (stepError) {
      console.error(`   ✗ Error executing step ${step.id}:`, stepError);
      step.status = 'failed';
      step.error = stepError.message;
    }
    step.completed_at = new Date();
    executionLogs.push({
      stepId: step.id,
      title: step.title,
      status: step.status,
      result: step.result,
      error: step.error
    });
  }

  // 5. Register overall Agent Action database log for audit trail views
  const logDecision = actionPlan.steps.find(s => s.type === 'reflection')?.params?.reasoningResult || {};
  const commStep = actionPlan.steps.find(s => s.type === 'communication');
  
  const actionRecord = {
    action_id: planId,
    userId,
    invoice_id: invoice.invoice_id || invoiceId,
    business_id: invoice.business_id,
    decision: logDecision.decision || 'no_action_needed',
    reasoning_summary: logDecision.whyThisDecision || 'Decision cycle logged.',
    message_sent: commStep?.params?.body || '',
    email_subject: commStep?.params?.subject || '',
    channel: logDecision.recommendedChannel || 'email',
    timestamp: new Date(),
    gemini_model_used: logDecision.source === 'gemini' ? 'gemini-1.5-flash' : 'rule-fallback',
    outcome: commStep ? commStep.status : 'skipped',
    urgency_score: logDecision.urgency || 1,
    escalation_level: invoice.escalationLevel || 0,
    email_preview_url: commStep?.result?.previewUrl || null
  };

  await db.collection(COLLECTIONS.AGENT_ACTIONS).doc(planId).set(actionRecord);

  return {
    planId,
    invoiceId,
    userId,
    status: steps.every(s => s.status === 'completed' || s.status === 'skipped') ? 'success' : 'partial_failure',
    steps: executionLogs
  };
}

module.exports = { executeActionPlan };
