const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { runSweep, approveAndExecute } = require('./agentService');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Serve the built client in production (single-service deploy) ────────────
// In local dev, the client runs separately via `npm run dev` on :5173 and this
// static dir won't exist yet — that's fine, express.static no-ops if the
// folder is missing rather than erroring.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_DIST));

// ── User-created invoices are persisted here (survives restarts) ─────────────
const USER_INVOICES_PATH = path.join(__dirname, 'user_invoices.json');

function loadUserInvoices() {
  try {
    if (fs.existsSync(USER_INVOICES_PATH)) {
      return JSON.parse(fs.readFileSync(USER_INVOICES_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Could not read user_invoices.json:', e.message);
  }
  return [];
}

function saveUserInvoices(list) {
  fs.writeFileSync(USER_INVOICES_PATH, JSON.stringify(list, null, 2));
}

// ── Invoice status (paid/active) tracked separately by invoice_id, so it
// applies uniformly to both curated SAMPLE_INVOICES and user-created ones ──
const INVOICE_STATUS_PATH = path.join(__dirname, 'invoice_status.json');

function loadInvoiceStatus() {
  try {
    if (fs.existsSync(INVOICE_STATUS_PATH)) {
      return JSON.parse(fs.readFileSync(INVOICE_STATUS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Could not read invoice_status.json:', e.message);
  }
  return {};
}

function saveInvoiceStatus(map) {
  fs.writeFileSync(INVOICE_STATUS_PATH, JSON.stringify(map, null, 2));
}

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
  const isMock = (process.env.USE_MOCK || process.env.COLLECT_AI_MOCK || 'false').toLowerCase() === 'true';
  res.json({
    status: 'ok',
    service: 'CollectAI Agent Server',
    mode: isMock ? 'mock-strands' : 'real-strands',
    model_provider: process.env.MODEL_PROVIDER || 'gemini',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/agent/invoices
 * Returns curated samples plus any user-created invoices.
 */
app.get('/api/agent/invoices', (req, res) => {
  const userInvoices = loadUserInvoices();
  const statusMap = loadInvoiceStatus();
  const withStatus = (inv) => ({ ...inv, status: statusMap[inv.invoice_id] || 'active' });
  res.json({ invoices: [...userInvoices, ...SAMPLE_INVOICES].map(withStatus) });
});

/**
 * POST /api/agent/invoices/:id/mark-paid
 * Closes the loop on an invoice's lifecycle: the human confirms payment
 * actually arrived, so the agent should stop chasing it. Works for both
 * curated sample invoices and user-created ones — status is tracked
 * separately by invoice_id, not baked into the invoice record itself.
 */
app.post('/api/agent/invoices/:id/mark-paid', (req, res) => {
  try {
    const { id } = req.params;
    const allInvoices = [...loadUserInvoices(), ...SAMPLE_INVOICES];
    if (!allInvoices.some((i) => i.invoice_id === id)) {
      return res.status(404).json({ error: 'Invoice not found', details: id });
    }
    const statusMap = loadInvoiceStatus();
    statusMap[id] = 'paid';
    saveInvoiceStatus(statusMap);
    console.log(`\n✅ [POST /api/agent/invoices/${id}/mark-paid] Marked paid.`);
    res.json({ invoice_id: id, status: 'paid' });
  } catch (error) {
    console.error('❌ [POST /api/agent/invoices/:id/mark-paid] Failed:', error);
    res.status(500).json({ error: 'Failed to mark invoice paid', details: error.message });
  }
});

/**
 * POST /api/agent/invoices
 * Create + persist a new invoice. Auto-derives a scenario label and defaults.
 */
app.post('/api/agent/invoices', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.client_name || b.amount == null) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'client_name and amount are required to create an invoice.',
      });
    }

    const userInvoices = loadUserInvoices();
    const nextNum = 2000 + userInvoices.length + 1;

    const daysOverdue = Number(b.days_overdue) || 0;
    const rel = b.relationship_score != null ? Number(b.relationship_score) : 75;
    const scenario =
      daysOverdue > 30 ? 'High Risk Escalation (Firm Draft Expected)'
      : daysOverdue > 10 ? 'Moderate Risk (Friendly Reminder Expected)'
      : 'Low Risk (Agent May Choose No Action)';

    const invoice = {
      invoice_id: b.invoice_id || `INV-${nextNum}`,
      client_name: String(b.client_name),
      amount: Number(b.amount),
      days_overdue: daysOverdue,
      ignored_reminders: b.ignored_reminders != null ? Number(b.ignored_reminders) : 0,
      relationship_score: rel,
      historical_on_time_rate: b.historical_on_time_rate != null ? Number(b.historical_on_time_rate) : 0.8,
      scenario,
    };

    userInvoices.unshift(invoice);
    saveUserInvoices(userInvoices);

    console.log(`\n➕ [POST /api/agent/invoices] Created ${invoice.invoice_id} for ${invoice.client_name}`);
    res.status(201).json({ invoice });
  } catch (error) {
    console.error('❌ [POST /api/agent/invoices] Failed:', error);
    res.status(500).json({ error: 'Failed to create invoice', details: error.message });
  }
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
    const allInvoices = [...loadUserInvoices(), ...SAMPLE_INVOICES];
    const invoice = req.body?.invoice || allInvoices.find(i => (req.body?.invoice_id && i.invoice_id === req.body.invoice_id) || (client_name && i.client_name === client_name));

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

// ── SPA fallback (production only) ──────────────────────────────────────────
// Any non-API GET request that didn't match a static file or API route falls
// through to the client's index.html, so client-side routing works on refresh.
app.get(/^(?!\/api).*/, (req, res, next) => {
  const indexPath = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next(); // no build present (local dev without `npm run build`) — just 404 normally
});

// ── Global Error Handler (must stay last) ────────────────────────────────────
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
