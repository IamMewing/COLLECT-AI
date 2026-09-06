const express = require('express');
const router = express.Router();
const { getDb, COLLECTIONS } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

// Apply authentication middleware
router.use(requireAuth);

/**
 * GET /api/stats — Get submission-evidence metrics scoped by userId
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not available' });

    const businessId = req.query.business_id;

    // ── Get all invoices scoped by userId ────────────────────────
    let invoicesQuery = db.collection(COLLECTIONS.INVOICES).where('userId', '==', req.userId);
    if (businessId) {
      invoicesQuery = invoicesQuery.where('business_id', '==', businessId);
    }
    const invoicesSnapshot = await invoicesQuery.get();

    let totalInvoices = 0;
    let openInvoices = 0;
    let paidInvoices = 0;
    let escalatedInvoices = 0;
    let closedInvoices = 0;
    let totalAmountOutstanding = 0;
    let totalAmountRecovered = 0;
    let totalDaysToPayment = 0;
    let paidWithDaysCount = 0;
    let totalEscalationLevel = 0;

    invoicesSnapshot.forEach(doc => {
      const data = doc.data();
      totalInvoices++;

      switch (data.status) {
        case 'open':
          openInvoices++;
          totalAmountOutstanding += data.amount || 0;
          break;
        case 'paid':
          paidInvoices++;
          totalAmountRecovered += data.amount || 0;
          if (data.due_date && data.paid_at) {
            const dueDate = data.due_date.toDate ? data.due_date.toDate() : new Date(data.due_date);
            const paidAt = data.paid_at.toDate ? data.paid_at.toDate() : new Date(data.paid_at);
            const daysToPayment = Math.max(0, Math.floor((paidAt - dueDate) / (1000 * 60 * 60 * 24)));
            totalDaysToPayment += daysToPayment;
            paidWithDaysCount++;
          }
          break;
        case 'escalated':
          escalatedInvoices++;
          totalAmountOutstanding += data.amount || 0;
          break;
        case 'closed':
          closedInvoices++;
          break;
      }

      totalEscalationLevel += data.escalation_level || 0;
    });

    // ── Get agent action stats scoped by userId ──────────────────
    let actionsQuery = db.collection(COLLECTIONS.AGENT_ACTIONS).where('userId', '==', req.userId);
    if (businessId) {
      actionsQuery = actionsQuery.where('business_id', '==', businessId);
    }
    const actionsSnapshot = await actionsQuery.get();

    let totalActions = 0;
    let messagesSent = 0;
    let decisionBreakdown = {
      no_action_needed: 0,
      gentle_reminder: 0,
      firm_nudge: 0,
      escalate_to_owner: 0
    };

    actionsSnapshot.forEach(doc => {
      const data = doc.data();
      totalActions++;
      if (data.outcome === 'sent') messagesSent++;
      if (decisionBreakdown[data.decision] !== undefined) {
        decisionBreakdown[data.decision]++;
      }
    });

    // ── Compute derived metrics ─────────────────────────
    const avgDaysToPayment = paidWithDaysCount > 0
      ? Math.round(totalDaysToPayment / paidWithDaysCount)
      : null;

    const avgEscalationLevel = totalInvoices > 0
      ? Math.round((totalEscalationLevel / totalInvoices) * 10) / 10
      : 0;

    const estimatedHoursSaved = Math.round((messagesSent * 15) / 60 * 10) / 10;

    const stats = {
      total_invoices: totalInvoices,
      open_invoices: openInvoices,
      paid_invoices: paidInvoices,
      escalated_invoices: escalatedInvoices,
      closed_invoices: closedInvoices,

      total_amount_outstanding: totalAmountOutstanding,
      total_amount_recovered: totalAmountRecovered,
      currency: 'INR',

      agent_decisions_made: totalActions,
      messages_sent: messagesSent,
      decision_breakdown: decisionBreakdown,

      average_days_to_payment: avgDaysToPayment,
      average_escalation_level: avgEscalationLevel,
      estimated_hours_saved: estimatedHoursSaved,

      collection_rate: totalInvoices > 0
        ? Math.round((paidInvoices / totalInvoices) * 100)
        : 0,

      generated_at: new Date().toISOString()
    };

    res.json(stats);
  } catch (error) {
    console.error('Error computing stats:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
