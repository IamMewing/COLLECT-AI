// ============================================
// CollectAI — Autonomous Agent Delegator Engine
// ============================================

const { triggerAutonomousSweep } = require('./scheduler/aiScheduler');
const { emitStage, emitComplete, emitError } = require('./services/jobProgress');

/**
 * Run the full agent cycle across all open invoices.
 * Delegates execution to the decoupled SaaS multi-tenant Agent Scheduler loop.
 * Emits real-time SSE stage events via jobProgress.
 *
 * @param {string} [businessId] - Optional: run only for a specific business
 * @param {string} [userId] - Optional: run only for a specific user
 * @param {string} [jobId] - Optional: SSE job ID for real-time stage events
 * @returns {Object} Summary of the agent run
 */
async function runAgentCycle(businessId = null, userId = null, jobId = null) {
  const start = Date.now();
  const activeUserId = userId || 'mock_user_123';

  const emit = (stageId, status, data = {}) => {
    if (jobId) emitStage(jobId, stageId, status, data);
  };

  try {
    // Stage 1: Starting
    emit('init', 'executing');
    await tick();

    // Stage 2: Fetching invoices (scheduler will do the actual fetch)
    emit('init', 'done');
    emit('fetch', 'executing');

    const sweepResult = await triggerAutonomousSweep(activeUserId, businessId, jobId);

    // Stage 10 + 11: Update + Complete (scheduler handles intermediate stages)
    emit('update', 'done');
    emit('complete', 'executing');
    await tick();

    // Count decisions mapping to frontend payload structure
    const decisionsCount = {
      no_action_needed: 0,
      gentle_reminder: 0,
      firm_nudge: 0,
      escalate_to_owner: 0,
      errors: 0
    };

    const formattedResults = [];

    sweepResult.results.forEach(res => {
      const dec = res.decision || 'no_action_needed';
      if (dec.includes('gentle') || dec.includes('friendly')) {
        decisionsCount.gentle_reminder++;
      } else if (dec.includes('firm') || dec.includes('professional') || dec.includes('urgent')) {
        decisionsCount.firm_nudge++;
      } else if (dec.includes('escalate') || dec.includes('owner')) {
        decisionsCount.escalate_to_owner++;
      } else if (res.status === 'failed') {
        decisionsCount.errors++;
      } else {
        decisionsCount.no_action_needed++;
      }

      formattedResults.push({
        invoice_id: res.invoiceNum,
        decision: dec,
        reasoning: res.whyThisDecision || 'Automated evaluation complete.',
        outcome: res.status === 'success' ? 'sent' : 'failed'
      });
    });

    const result = {
      success: true,
      invoicesEvaluated: sweepResult.invoicesEvaluated,
      durationMs: Date.now() - start,
      decisions: decisionsCount,
      results: formattedResults
    };

    if (jobId) emitComplete(jobId, result);

    return result;

  } catch (error) {
    console.error('SaaS Agent sweep wrapper error:', error);
    if (jobId) emitError(jobId, error.message);

    return {
      success: false,
      error: error.message,
      invoicesEvaluated: 0,
      durationMs: Date.now() - start,
      decisions: {
        no_action_needed: 0,
        gentle_reminder: 0,
        firm_nudge: 0,
        escalate_to_owner: 0,
        errors: 1
      },
      results: []
    };
  }
}

function tick() {
  return new Promise(r => setTimeout(r, 50));
}

module.exports = { runAgentCycle };
