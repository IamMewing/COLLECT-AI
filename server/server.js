const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { runSweep, approveAndExecute } = require('./agentService');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Curated Sample Invoices for Testing Different Graph Paths ───────────────
const SAMPLE_INVOICES = [
  {
    invoice_id: 'INV-1042',
    client_name: 'Meridian Design Co.',
    amount: 185000,
    days_overdue: 34,
    ignored_reminders: 2,
    relationship_score: 62,
    historical_on_time_rate: 0.55,
    scenario: 'High Risk Escalation (Generates Firm Draft)',
  },
  {
    invoice_id: 'INV-1043',
    client_name: 'Acme Creative Studio',
    amount: 42000,
    days_overdue: 3,
    ignored_reminders: 0,
    relationship_score: 92,
    historical_on_time_rate: 0.94,
    scenario: 'Low Risk / High Probability (Plan Chooses No Action)',
  },
  {
    invoice_id: 'INV-1044',
    client_name: 'Apex Horizon Tech',
    amount: 95000,
    days_overdue: 12,
    ignored_reminders: 1,
    relationship_score: 78,
    historical_on_time_rate: 0.72,
    scenario: 'Moderate Risk (Generates Friendly Reminder Draft)',
  },
];

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Basic health check with service details.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CollectAI Agent Server',
    mode: process.env.COLLECT_AI_MOCK === 'false' ? 'real-strands' : 'mock-strands',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/agent/invoices
 * Returns test invoices with diverse risk & probability profiles.
 */
app.get('/api/agent/invoices', (req, res) => {
  res.json({ invoices: SAMPLE_INVOICES });
});

/**
 * POST /api/agent/sweep
 * Runs the risk assessment, probability forecast, and plan sweep for a given invoice.
 * Calls agent.mock_run_sweep() (or real agent.run_sweep()).
 */
app.post('/api/agent/sweep', async (req, res) => {
  try {
    const invoice = req.body?.invoice || SAMPLE_INVOICES[0];
    console.log(`\n🔍 [POST /api/agent/sweep] Running sweep for invoice ${invoice.invoice_id || 'unnamed'} (${invoice.client_name})`);

    const result = await runSweep(invoice);
    res.json(result);
  } catch (error) {
    console.error('❌ [POST /api/agent/sweep] Failed:', error);
    res.status(error.status || 500).json({
      error: error.error || 'Failed to execute agent sweep',
      details: error.details || error.message || 'Unknown error occurred',
      stderr: error.stderr || null,
      status: error.status || 500,
    });
  }
});

/**
 * POST /api/agent/approve
 * Human-in-the-loop decision: Approve, Edit, or Reject a drafted message.
 * Calls agent.mock_approve_and_execute() (or real agent.approve_and_execute()).
 */
app.post('/api/agent/approve', async (req, res) => {
  try {
    const { draft, approved, edited_body, client_name } = req.body || {};
    const invoice = req.body?.invoice || SAMPLE_INVOICES.find(i => (req.body?.invoice_id && i.invoice_id === req.body.invoice_id) || (client_name && i.client_name === client_name));

    if (!draft) {
      return res.status(400).json({
        error: 'Missing required field: draft',
        details: 'The draft message object { subject, body, channel } is required.',
      });
    }

    console.log(`\n⚖️ [POST /api/agent/approve] Decision: ${approved ? 'APPROVED' : 'REJECTED'} for "${draft.subject}"`);
    if (edited_body) {
      console.log(`📝 Human edited the message body before approving.`);
    }

    const result = await approveAndExecute(draft, approved, edited_body, client_name, invoice);
    res.json(result);
  } catch (error) {
    console.error('❌ [POST /api/agent/approve] Failed:', error);
    res.status(error.status || 500).json({
      error: error.error || 'Failed to process approval decision',
      details: error.details || error.message || 'Unknown error occurred',
      stderr: error.stderr || null,
      status: error.status || 500,
    });
  }
});

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔴 Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// ── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ CollectAI Agent Server running on http://localhost:${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/api/health`);
  console.log(`🎯 Sweep:  POST http://localhost:${PORT}/api/agent/sweep`);
  console.log(`⚖️ Approve: POST http://localhost:${PORT}/api/agent/approve\n`);
});

module.exports = app;
