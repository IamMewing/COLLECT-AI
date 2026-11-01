const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { runSweep, approveAndExecute, confirmPayment } = require('./agentService');
const paypalService = require('./paypalService');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
// `verify` stashes the raw request body alongside the parsed JSON — needed
// because PayPal webhook signature verification must hash the exact bytes
// PayPal sent, not a re-serialized copy of req.body.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

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

// ── PayPal order mapping: paypal_order_id -> { invoice_id, client_name } ────
// This is how an incoming webhook (which only knows PayPal's order id)
// finds its way back to our internal invoice record.
const PAYPAL_ORDERS_PATH = path.join(__dirname, 'paypal_orders.json');

function loadPaypalOrderMap() {
  try {
    if (fs.existsSync(PAYPAL_ORDERS_PATH)) {
      return JSON.parse(fs.readFileSync(PAYPAL_ORDERS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Could not read paypal_orders.json:', e.message);
  }
  return {};
}

function savePaypalOrderMap(map) {
  fs.writeFileSync(PAYPAL_ORDERS_PATH, JSON.stringify(map, null, 2));
}

/**
 * Marks an invoice paid and persists it — shared by the human "mark paid"
 * button and the PayPal webhook handler, so both paths behave identically.
 * Records *how* it was closed ('manual' vs 'paypal') so the UI can show the
 * closed-loop story, not just a flat paid/unpaid flag.
 */
function markInvoicePaidInternal(invoiceId, via = 'manual') {
  const statusMap = loadInvoiceStatus();
  statusMap[invoiceId] = { status: 'paid', via, at: new Date().toISOString() };
  saveInvoiceStatus(statusMap);
}

/** Normalizes a statusMap entry, which may be the legacy plain string 'paid'
 * (from before `paid_via` tracking existed) or the current {status, via, at}
 * object, into { status, paid_via }. */
function normalizeStatusEntry(entry) {
  if (!entry) return { status: 'active', paid_via: undefined };
  if (typeof entry === 'string') return { status: entry, paid_via: undefined };
  return { status: entry.status || 'active', paid_via: entry.via };
}

/** Replaces the agent's {{PAYMENT_LINK}} token with a real link, or removes
 * the line cleanly if no link is available (PayPal not configured, or the
 * sandbox call failed) so the message still reads naturally. */
function substitutePaymentLink(body, link) {
  if (!body || !body.includes('{{PAYMENT_LINK}}')) return body;
  if (link) {
    return body.replace('{{PAYMENT_LINK}}', `Pay instantly via PayPal: ${link}`);
  }
  // No link available — drop the token and any now-empty trailing blank line.
  return body.replace(/\n*\{\{PAYMENT_LINK\}\}\n*/g, '\n').trimEnd();
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
  const withStatus = (inv) => ({ ...inv, ...normalizeStatusEntry(statusMap[inv.invoice_id]) });
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
    markInvoicePaidInternal(id);
    console.log(`\n✅ [POST /api/agent/invoices/${id}/mark-paid] Marked paid (manual).`);
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

    // ── Real PayPal sandbox order, created only on approval ──────────────────
    // This is the agentic-commerce step: the plan/draft agents already decided
    // *to* act; this is where that decision becomes a real, payable PayPal
    // link instead of just an email. Fails soft — any PayPal error just means
    // no payment link gets woven in, it never blocks approval.
    let paymentLink = null;
    if (approved && paypalService.isConfigured() && invoice && invoice.amount) {
      try {
        // Demo invoices are seeded in INR; sandbox needs a currency the test
        // merchant account accepts. A rough fixed conversion is fine here —
        // this is a sandbox demo amount, never real billing.
        const inrPerUsd = Number(process.env.PAYPAL_DEMO_INR_PER_USD) || 83;
        const amountUsd = Number(invoice.amount) / inrPerUsd;

        const ppResult = await paypalService.createAndSendOrder({
          invoiceId: invoice.invoice_id,
          clientName: invoice.client_name,
          amount: amountUsd,
          currency: process.env.PAYPAL_CURRENCY || 'USD',
          note: `CollectAI follow-up — ${draft.subject}`,
        });
        paymentLink = ppResult.paymentLink;

        const map = loadPaypalOrderMap();
        map[ppResult.paypalOrderId] = { invoice_id: invoice.invoice_id, client_name: invoice.client_name };
        savePaypalOrderMap(map);

        console.log(`💳 [PayPal] Sandbox order ${ppResult.paypalOrderId} created for ${invoice.invoice_id}. Link: ${paymentLink || '(pending)'}`);
      } catch (ppError) {
        console.error('⚠️  [PayPal] Order creation failed — continuing without a real payment link:', ppError.message);
      }
    }

    // Bake the (possibly human-edited) body + the real-or-absent payment link
    // into one final body before it ever reaches the Python approve step.
    const finalBody = substitutePaymentLink(edited_body || draft.body, paymentLink);
    const finalDraft = { ...draft, body: finalBody };

    const result = await approveAndExecute(finalDraft, approved, null, client_name, invoice);
    res.json({ ...result, paypal_payment_link: paymentLink });
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

/**
 * GET /api/paypal/status
 * Lets the UI show whether PayPal is actually wired up (and in what mode),
 * instead of silently falling back to stubbed sends.
 */
app.get('/api/paypal/status', (req, res) => {
  res.json({
    configured: paypalService.isConfigured(),
    environment: (process.env.PAYPAL_ENV || 'sandbox').toLowerCase(),
    webhook_configured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
  });
});

/**
 * POST /api/paypal/webhook
 * PayPal calls this when an order event happens. This is what replaces the
 * manual "mark paid" button for real: when the client approves the order
 * (CHECKOUT.ORDER.APPROVED), we immediately capture the payment server-side,
 * and on a successful capture the invoice is marked paid AND the agent runs
 * a genuine reflection on a real payment event, not a human checkbox.
 *
 * Signature verification needs PAYPAL_WEBHOOK_ID (set once you create the
 * webhook in the Developer Dashboard and copy its ID into .env). Until then,
 * events are processed but logged as UNVERIFIED — fine for local iteration,
 * tighten this (reject unverified events) before the final demo/submission.
 */
app.post('/api/paypal/webhook', async (req, res) => {
  try {
    const rawBody = req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body);
    const verified = await paypalService.verifyWebhookSignature(req.headers, rawBody);

    if (!verified) {
      console.warn(
        process.env.PAYPAL_WEBHOOK_ID
          ? '⚠️  [PayPal webhook] Signature verification FAILED — processing anyway for now, but check PAYPAL_WEBHOOK_ID.'
          : '⚠️  [PayPal webhook] PAYPAL_WEBHOOK_ID not set — event is UNVERIFIED. Set it before the final demo.'
      );
    }

    const event = req.body || {};
    const eventType = event.event_type;
    console.log(`\n📬 [PayPal webhook] Received ${eventType || '(unknown event)'}${verified ? ' [verified]' : ' [unverified]'}`);

    // Always 200 quickly so PayPal doesn't retry-storm us.
    if (eventType !== 'CHECKOUT.ORDER.APPROVED') {
      return res.status(200).json({ received: true, ignored: eventType || 'unknown' });
    }

    const ppOrderId = event.resource?.id;
    const map = loadPaypalOrderMap();
    const mapping = ppOrderId ? map[ppOrderId] : null;

    if (!mapping) {
      console.warn(`⚠️  [PayPal webhook] No internal invoice mapped to PayPal order ${ppOrderId} — ignoring.`);
      return res.status(200).json({ received: true, mapped: false });
    }

    // The client approved — now actually capture the funds.
    const captureResult = await paypalService.captureOrder(ppOrderId);
    if (captureResult?.status !== 'COMPLETED') {
      console.warn(`⚠️  [PayPal webhook] Capture for order ${ppOrderId} returned status ${captureResult?.status} — not marking paid.`);
      return res.status(200).json({ received: true, mapped: true, captured: false, status: captureResult?.status });
    }

    markInvoicePaidInternal(mapping.invoice_id, 'paypal');
    console.log(`✅ [PayPal webhook] Order ${ppOrderId} captured — invoice ${mapping.invoice_id} (${mapping.client_name}) marked paid automatically.`);

    const allInvoices = [...loadUserInvoices(), ...SAMPLE_INVOICES];
    const invoice = allInvoices.find((i) => i.invoice_id === mapping.invoice_id) || null;

    const closeLoopResult = await confirmPayment(mapping.client_name, invoice);
    console.log(`🔁 [PayPal webhook] Agent reflection closed the loop:`, closeLoopResult.reflection?.suggested_tone_shift || closeLoopResult.status);

    res.status(200).json({ received: true, mapped: true, captured: true, invoice_id: mapping.invoice_id, closeLoopResult });
  } catch (error) {
    // Still 200 here in spirit-of-webhooks terms would be debatable; 500 is
    // fine since PayPal retries failed webhook deliveries automatically.
    console.error('❌ [PayPal webhook] Failed:', error);
    res.status(500).json({ error: 'Webhook handling failed', details: error.message });
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
