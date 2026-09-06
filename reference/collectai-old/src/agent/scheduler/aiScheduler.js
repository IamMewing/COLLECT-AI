// ============================================
// CollectAI — Autonomous AI Scheduler
// ============================================

const { getDb, COLLECTIONS } = require('../../config/firebase');
const { generateStrategy, executePlan } = require('../services/agentApi');
const { setAgentStatus } = require('../services/liveStatus');
const { emitStage } = require('../services/jobProgress');

/**
 * Runs a complete autonomous sweep over outstanding user invoices.
 * Evaluates risk, runs reasoning, executes communication scripts, and updates memories.
 * Emits real-time SSE stage events via jobId.
 *
 * @param {string} userId
 * @param {string|null} businessId
 * @param {string|null} jobId - SSE job ID for real-time events
 */
async function triggerAutonomousSweep(userId, businessId = null, jobId = null) {
  const emit = (stageId, status, data = {}) => {
    if (jobId) emitStage(jobId, stageId, status, data);
  };

  try {
    setAgentStatus('Scanning');
    const db = getDb();
    if (!db) throw new Error('Firestore not initialized');

    // Stage: Fetch complete, now load client profiles
    emit('fetch', 'done');
    emit('client', 'executing');

    // 1. Fetch overdue invoices
    let query = db.collection(COLLECTIONS.INVOICES)
      .where('status', 'in', ['open', 'escalated'])
      .where('userId', '==', userId);

    if (businessId) {
      query = query.where('business_id', '==', businessId);
    }

    const snapshot = await query.get();
    const invoices = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    snapshot.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      
      const dueDate = data.due_date?.toDate ? data.due_date.toDate() : new Date(data.due_date);
      if (dueDate > today) return; // Not overdue yet

      // Check next review threshold
      if (data.next_check_date) {
        const nextCheck = data.next_check_date?.toDate ? data.next_check_date.toDate() : new Date(data.next_check_date);
        if (nextCheck > today) return; // Wait
      }
      
      invoices.push(data);
    });

    console.log(`📋 [SCHEDULER] Sweeping ${invoices.length} invoices for user: ${userId}`);

    // Client profiles loaded
    emit('client', 'done');
    emit('history', 'executing');

    // Brief pause to let event propagate
    await tick();

    const results = [];

    if (invoices.length === 0) {
      // No overdue invoices — fast-forward through stages
      emit('history', 'done');
      emit('risk', 'executing');
      await tick();
      emit('risk', 'done');
      emit('evaluate', 'executing');
      await tick();
      emit('evaluate', 'done');
      emit('gemini', 'executing');
      await tick();
      emit('gemini', 'done');
      emit('draft', 'executing');
      await tick();
      emit('draft', 'done');
      emit('save', 'executing');
      await tick();
      emit('save', 'done');
      emit('update', 'executing');
      await tick();

      setAgentStatus('Ready');
      return {
        userId,
        timestamp: new Date(),
        invoicesEvaluated: 0,
        results: []
      };
    }

    // 2. Loop and process each invoice
    for (let idx = 0; idx < invoices.length; idx++) {
      const inv = invoices[idx];
      try {
        console.log(`📋 [SCHEDULER] Evaluating Invoice #${inv.invoice_id}`);

        // Emit stages per invoice (on first invoice, or every invoice if few)
        if (idx === 0) {
          emit('history', 'done');
          emit('risk', 'executing');
        }

        // Context + Reasoning + Strategy
        const { plan, context } = await generateStrategy(inv.id, userId);

        if (idx === 0) {
          emit('risk', 'done');
          emit('evaluate', 'executing');
          await tick();
          emit('evaluate', 'done');
          emit('gemini', 'executing');
        }

        // Execution Engine (Sends reminders, logs reflections)
        const executionResult = await executePlan(plan, context);

        if (idx === 0) {
          emit('gemini', 'done');
          emit('draft', 'executing');
          await tick();
          emit('draft', 'done');
          emit('save', 'executing');
          await tick();
          emit('save', 'done');
          emit('update', 'executing');
          await tick();
        }
        
        results.push({
          invoiceId: inv.id,
          invoiceNum: inv.invoice_id,
          status: 'success',
          decision: plan.steps.find(s => s.type === 'reflection')?.params?.reasoningResult?.decision || 'no_action_needed',
          steps: executionResult.steps
        });
      } catch (err) {
        console.error(`📋 [SCHEDULER] Invoice evaluation failure: ${inv.id}`, err);
        results.push({
          invoiceId: inv.id,
          invoiceNum: inv.invoice_id,
          status: 'failed',
          error: err.message
        });
      }
    }

    setAgentStatus('Ready');
    return {
      userId,
      timestamp: new Date(),
      invoicesEvaluated: invoices.length,
      results
    };
  } catch (error) {
    setAgentStatus('Ready');
    console.error('Autonomous sweep error:', error);
    throw error;
  }
}

function tick() {
  return new Promise(r => setTimeout(r, 80));
}

module.exports = { triggerAutonomousSweep };
