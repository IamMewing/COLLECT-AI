const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { runSweep, approveAndExecute, confirmPayment, checkReplies, confirmInstallmentPaid } = require('./agentService');
const paypalService = require('./paypalService');
const store = require('./store');
const { parseInvoiceCsv } = require('./csvImport');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Cloud Run sits behind Google's load balancer, which adds one hop to
// X-Forwarded-For before the request reaches us — without this, express's
// req.ip (and therefore express-rate-limit's default per-IP key) resolves
// to the load balancer's address for every request, putting the whole
// public demo behind a single shared rate-limit bucket instead of one per
// visitor. `1` means "trust exactly one proxy hop," which matches Cloud
// Run's setup; in local dev there's no proxy in front, so this is a no-op.
app.set('trust proxy', 1);

// ── Middleware ───────────────────────────────────────────────────────────────
// `credentials: true` + reflecting the request's own Origin (rather than
// `*`, which the CORS spec disallows once credentials are involved) is what
// lets the session cookie (the password gate, see auth.js) survive local
// dev, where the Vite client (:5173) and this API (:3001) are different
// origins. In production they're the same origin and this is a no-op.
app.use(cors({ origin: true, credentials: true }));
// `verify` stashes the raw request body alongside the parsed JSON — needed
// because PayPal webhook signature verification must hash the exact bytes
// PayPal sent, not a re-serialized copy of req.body.
app.use(
  express.json({
    // Default is 100kb, which a CSV invoice import can plausibly exceed
    // (a few hundred rows with long client names) well before it's
    // anywhere near an actually unreasonable upload.
    limit: '2mb',
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

// ── Rate limiting for the LLM-metered agent endpoints ───────────────────────
// This is a public hackathon demo backed by a single shared GEMINI_API_KEY —
// without a cap, one visitor hammering "Run the agent" (or a script doing it
// for them) can burn through the key's quota or run up cost for everyone
// else. Sweep, portfolio sweep, and approve all invoke the Python bridge
// (and, in real mode, an actual Gemini call), so they share ONE limiter
// instance — a budget across all three, not a separate one each, since
// sweep-all alone can fire several LLM calls in a single request and
// shouldn't be a way to route around a per-endpoint cap. Invoice CRUD and
// reads aren't metered the same way and are left uncapped.
const agentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    details: 'This is a shared public demo — please wait a few minutes before running the agent again.',
  },
});

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

// ── Shared-password gate ─────────────────────────────────────────────────────
// Everything below this point except the PayPal webhook (which real PayPal
// servers call with no browser, no cookie, and no way to type a password)
// and the SPA's own static files (so the React app can load far enough to
// show the password prompt in the first place) requires a valid session.
// See server/auth.js — the whole gate no-ops when ACCESS_PASSWORD isn't set.

app.get('/api/auth/status', (req, res) => {
  res.json({ required: auth.AUTH_ENABLED, authenticated: auth.isAuthenticated(req) });
});

app.post('/api/auth/login', (req, res) => {
  if (!auth.AUTH_ENABLED) {
    return res.json({ authenticated: true });
  }
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ error: 'Wrong password', details: 'That password doesn’t match.' });
  }
  res.cookie(auth.COOKIE_NAME, auth.makeSessionCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    // Cloud Run terminates TLS in front of the container and sets K_SERVICE
    // on every revision, so this is true in production without needing a
    // separate NODE_ENV=production setting, and false in local http dev
    // (a Secure cookie is silently dropped by the browser over plain http).
    secure: Boolean(process.env.K_SERVICE),
    maxAge: auth.SESSION_TTL_MS,
  });
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME);
  res.json({ authenticated: false });
});

/**
 * POST /api/agent/check-replies
 * Polls the inbox for client replies and runs each one through the
 * autonomous negotiation loop (see agent/inbox.py + agent/execute.py's
 * handle_incoming_reply). Meant to be hit on a schedule — a Cloud Scheduler
 * job every few minutes, since Cloud Run doesn't run a persistent
 * background process — not from the UI.
 *
 * Registered here, ABOVE the `/api/agent` auth-prefix middleware below, with
 * its own requireAuthOrSchedulerSecret so it fully handles the request and
 * never reaches that prefix: an unattended scheduled job has no browser
 * session cookie to present, only the X-Scheduler-Secret header (see
 * server/auth.js). SCHEDULER_SECRET unset means this still falls back to
 * the normal cookie gate, same as every other /api/agent/* route.
 */
app.post('/api/agent/check-replies', auth.requireAuthOrSchedulerSecret, agentLimiter, async (req, res) => {
  try {
    const result = await checkReplies();
    console.log(
      `\n📨 [POST /api/agent/check-replies] Checked inbox — ${result.checked} new repl${result.checked === 1 ? 'y' : 'ies'}.`
    );
    res.json(result);
  } catch (error) {
    console.error('❌ [POST /api/agent/check-replies] Failed:', error);
    res.status(error.status || 500).json({
      error: error.error || 'Failed to check for replies',
      details: error.details || error.message || 'Unknown error occurred',
      stderr: error.stderr || null,
      status: error.status || 500,
    });
  }
});

// Gates every /api/agent/* and /api/history route defined below this line,
// plus /api/paypal/status — registered as path-prefix middleware so each
// route doesn't need auth.requireAuth added individually (and can't be
// accidentally left off a new one later). Must stay ABOVE those route
// definitions; Express middleware only applies to routes registered after it.
// (/api/agent/check-replies above is the one exception — it's registered
// earlier than this line specifically so it is NOT gated by this plain
// cookie-only check; see its own comment.)
app.use('/api/agent', auth.requireAuth);
app.use('/api/history', auth.requireAuth);

/**
 * GET /api/agent/invoices
 * Returns curated samples plus any user-created invoices.
 */
app.get('/api/agent/invoices', async (req, res) => {
  try {
    const userInvoices = await store.loadUserInvoices();
    const statusMap = await store.loadInvoiceStatus();
    const withStatus = (inv) => ({ ...inv, ...normalizeStatusEntry(statusMap[inv.invoice_id]) });
    res.json({ invoices: [...userInvoices, ...SAMPLE_INVOICES].map(withStatus) });
  } catch (error) {
    console.error('❌ [GET /api/agent/invoices] Failed:', error);
    res.status(500).json({ error: 'Failed to load invoices', details: error.message });
  }
});

/**
 * POST /api/agent/invoices/:id/mark-paid
 * Closes the loop on an invoice's lifecycle: the human confirms payment
 * actually arrived, so the agent should stop chasing it. Works for both
 * curated sample invoices and user-created ones — status is tracked
 * separately by invoice_id, not baked into the invoice record itself.
 */
app.post('/api/agent/invoices/:id/mark-paid', async (req, res) => {
  try {
    const { id } = req.params;
    const allInvoices = [...(await store.loadUserInvoices()), ...SAMPLE_INVOICES];
    if (!allInvoices.some((i) => i.invoice_id === id)) {
      return res.status(404).json({ error: 'Invoice not found', details: id });
    }
    await store.markInvoicePaid(id, 'manual');
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
app.post('/api/agent/invoices', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.client_name || b.amount == null) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'client_name and amount are required to create an invoice.',
      });
    }
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) {
      return res.status(400).json({
        error: 'Invalid email',
        details: `"${b.email}" doesn't look like a valid email address.`,
      });
    }

    const userInvoices = await store.loadUserInvoices();
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
      // Real contact address so a real-mode send can go to the actual
      // client instead of the fixed DEMO_RECIPIENT_EMAIL fallback. Omitted
      // (not an empty string) when not given, so downstream email-presence
      // checks ("does this invoice have a real contact") stay simple.
      ...(b.email ? { email: String(b.email).trim() } : {}),
    };

    await store.saveNewInvoice(invoice);

    console.log(`\n➕ [POST /api/agent/invoices] Created ${invoice.invoice_id} for ${invoice.client_name}`);
    res.status(201).json({ invoice });
  } catch (error) {
    console.error('❌ [POST /api/agent/invoices] Failed:', error);
    res.status(500).json({ error: 'Failed to create invoice', details: error.message });
  }
});

/**
 * POST /api/agent/invoices/import
 * Bulk-creates invoices from CSV text (body: { csv: string }). Partial
 * success is the expected outcome, not an error case — a 200-row import
 * with three typos in it should save the other 197 and report exactly
 * which rows failed and why, not reject the whole batch. See csvImport.js
 * for the column format and per-row validation rules (the same rules
 * POST /api/agent/invoices applies to a single manual create).
 */
app.post('/api/agent/invoices/import', async (req, res) => {
  try {
    const csvText = req.body?.csv;
    if (typeof csvText !== 'string' || !csvText.trim()) {
      return res.status(400).json({ error: 'Missing CSV', details: 'Expected { csv: "<file contents>" } in the request body.' });
    }

    const { invoices: parsedInvoices, errors, warnings } = parseInvoiceCsv(csvText);

    if (parsedInvoices.length === 0) {
      return res.status(400).json({ error: 'Nothing to import', details: 'No valid rows were found.', errors, warnings });
    }

    const userInvoices = await store.loadUserInvoices();
    let nextNum = 2000 + userInvoices.length + 1;
    const created = [];

    for (const parsed of parsedInvoices) {
      const daysOverdue = parsed.days_overdue;
      const scenario =
        daysOverdue > 30 ? 'High Risk Escalation (Firm Draft Expected)'
        : daysOverdue > 10 ? 'Moderate Risk (Friendly Reminder Expected)'
        : 'Low Risk (Agent May Choose No Action)';

      const invoice = {
        ...parsed,
        invoice_id: parsed.invoice_id || `INV-${nextNum}`,
        scenario,
      };
      if (!parsed.invoice_id) nextNum += 1;

      // Sequential, not Promise.all: keeps the INV-#### numbering strictly
      // in file order (matches how a person reading the CSV top-to-bottom
      // would expect rows to be numbered) and, more importantly, avoids a
      // burst of concurrent writes to the same local JSON file racing each
      // other — the local fallback path is read-modify-write-the-whole-
      // file, not a per-document write like Firestore.
      await store.saveNewInvoice(invoice);
      created.push(invoice);
    }

    console.log(`\n📥 [POST /api/agent/invoices/import] Imported ${created.length} invoice(s), ${errors.length} row error(s).`);
    res.status(created.length > 0 ? 201 : 400).json({
      created,
      created_count: created.length,
      errors,
      warnings,
    });
  } catch (error) {
    console.error('❌ [POST /api/agent/invoices/import] Failed:', error);
    res.status(500).json({ error: 'Failed to import invoices', details: error.message });
  }
});

/**
 * POST /api/agent/sweep
 * Runs the risk assessment, probability forecast, and plan sweep for a given invoice.
 * Calls agent.mock_run_sweep() (or real agent.run_sweep()).
 */
app.post('/api/agent/sweep', agentLimiter, async (req, res) => {
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
 * Runs an array of async jobs with at most `limit` in flight at once.
 *
 * A portfolio sweep fans out to one Python process per invoice (see
 * agentService.callAgentBridge), each making real model calls in non-mock
 * mode. Firing all of them at once is exactly what trips the free-tier rate
 * limit this codebase already has retry logic for elsewhere — so this caps
 * concurrency instead of relying on that retry to paper over a self-inflicted
 * burst. One failed invoice is reported per-invoice, not thrown — a demo
 * sweeping five accounts shouldn't go blank because the third one rate-limited.
 */
async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runNext() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

/**
 * POST /api/agent/sweep-all
 * Runs the agent across every open (non-paid) invoice in one call, instead of
 * one at a time — the difference between demonstrating the agent and
 * demonstrating a receivables ops tool. Optional body: { invoice_ids: [...] }
 * to scope the sweep to a subset; omitted or empty means "everything open".
 */
app.post('/api/agent/sweep-all', agentLimiter, async (req, res) => {
  try {
    const statusMap = await store.loadInvoiceStatus();
    const withStatus = (inv) => ({ ...inv, ...normalizeStatusEntry(statusMap[inv.invoice_id]) });
    const all = [...(await store.loadUserInvoices()), ...SAMPLE_INVOICES].map(withStatus);

    const requestedIds = Array.isArray(req.body?.invoice_ids) ? new Set(req.body.invoice_ids) : null;
    const targets = all.filter((inv) => {
      if (inv.status === 'paid') return false;
      return !requestedIds || requestedIds.has(inv.invoice_id);
    });

    if (targets.length === 0) {
      return res.json({ results: [], summary: { total: 0, escalation: 0, standard: 0, no_action: 0, failed: 0 } });
    }

    console.log(`\n📋 [POST /api/agent/sweep-all] Sweeping ${targets.length} open invoice(s)…`);

    const outcomes = await withConcurrency(targets, 2, (inv) => runSweep(inv));

    const results = outcomes.map((o, i) => {
      const invoice = targets[i];
      if (!o.ok) {
        const err = o.error || {};
        return {
          invoice_id: invoice.invoice_id,
          client_name: invoice.client_name,
          ok: false,
          error: err.error || err.message || 'Sweep failed',
          details: err.details || null,
        };
      }
      return { invoice_id: invoice.invoice_id, client_name: invoice.client_name, ok: true, ...o.value };
    });

    const summary = results.reduce(
      (acc, r) => {
        acc.total += 1;
        if (!r.ok) { acc.failed += 1; return acc; }
        const branch = r.plan?.branch;
        if (branch === 'escalation') acc.escalation += 1;
        else if (branch === 'no_action') acc.no_action += 1;
        else acc.standard += 1;
        return acc;
      },
      { total: 0, escalation: 0, standard: 0, no_action: 0, failed: 0 }
    );

    res.json({ results, summary });
  } catch (error) {
    console.error('❌ [POST /api/agent/sweep-all] Failed:', error);
    res.status(500).json({ error: 'Failed to sweep the portfolio', details: error.message });
  }
});

/**
 * POST /api/agent/approve
 * Human-in-the-loop decision: Approve, Edit, or Reject a drafted message.
 * Calls agent.mock_approve_and_execute() (or real agent.approve_and_execute()).
 */
app.post('/api/agent/approve', agentLimiter, async (req, res) => {
  try {
    const { draft, approved, edited_body, client_name } = req.body || {};
    const allInvoices = [...(await store.loadUserInvoices()), ...SAMPLE_INVOICES];
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

        await store.savePaypalOrderMapping(ppResult.paypalOrderId, {
          invoice_id: invoice.invoice_id,
          client_name: invoice.client_name,
        });

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
app.get('/api/paypal/status', auth.requireAuth, (req, res) => {
  res.json({
    configured: paypalService.isConfigured(),
    environment: (process.env.PAYPAL_ENV || 'sandbox').toLowerCase(),
    webhook_configured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    // Surfaced so this misconfiguration shows up on a status page instead of
    // only in server logs — it's the one setting that, left on, undoes the
    // webhook handler's whole point.
    webhook_unverified_allowed: (process.env.PAYPAL_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true',
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
 * webhook in the Developer Dashboard and copy its ID into .env).
 *
 * An unverified event is REFUSED, not processed-with-a-warning — this is the
 * one endpoint in the app that can be made to capture a real payment and
 * mark an invoice closed, so trusting a POST just because it arrived here
 * would mean anyone who finds this URL can forge "the client paid" for any
 * invoice they know the PayPal order id for. The one escape hatch is
 * PAYPAL_WEBHOOK_ALLOW_UNVERIFIED=true, for local testing without a
 * registered webhook — it must never be true where this is actually
 * reachable from the internet.
 */
app.post('/api/paypal/webhook', async (req, res) => {
  try {
    const rawBody = req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body);
    const verified = await paypalService.verifyWebhookSignature(req.headers, rawBody);
    const allowUnverified = (process.env.PAYPAL_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true';

    if (!verified) {
      const reason = process.env.PAYPAL_WEBHOOK_ID
        ? 'signature verification failed'
        : 'PAYPAL_WEBHOOK_ID is not set, so there is nothing to verify the signature against';

      if (!allowUnverified) {
        console.warn(`⛔ [PayPal webhook] Rejected (401) — ${reason}.`);
        // 401, not 200: an unverified call must not look like a successful,
        // trusted delivery to whoever sent it. A correctly-configured real
        // PayPal webhook is always signed, so this branch never fires for
        // genuine traffic once PAYPAL_WEBHOOK_ID is set — it only stops a
        // forged or misrouted POST from being treated as one.
        return res.status(401).json({
          error: 'Webhook signature not verified',
          details: reason,
        });
      }

      console.warn(
        `⚠️  [PayPal webhook] UNVERIFIED event processed anyway — ${reason}. ` +
        `PAYPAL_WEBHOOK_ALLOW_UNVERIFIED is set; this must be unset wherever this server is internet-reachable.`
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
    const mapping = ppOrderId ? await store.getPaypalOrderMapping(ppOrderId) : null;

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

    // An order the negotiate agent minted for one installment of a payment
    // plan (agent/tools/paypal_tools.py tags its mapping 'plan_installment')
    // must NOT close out the whole invoice the way a normal order does —
    // paying installment 1 of 3 is progress, not completion. mapping.kind is
    // absent on every mapping Node itself has ever written (the sweep/approve
    // flow above), so that path is completely unaffected by this branch.
    if (mapping.kind === 'plan_installment') {
      const result = await confirmInstallmentPaid(mapping.invoice_id, mapping.installment_index, ppOrderId);
      console.log(
        `🔁 [PayPal webhook] Installment ${mapping.installment_index} of ${mapping.invoice_id} captured — plan status: ${result.status}.`
      );
      // Only the FINAL installment actually finishes the invoice.
      if (result.status === 'completed') {
        await store.markInvoicePaid(mapping.invoice_id, 'paypal');
        console.log(`✅ [PayPal webhook] All installments paid — invoice ${mapping.invoice_id} marked paid.`);
      }
      return res.status(200).json({ received: true, mapped: true, captured: true, invoice_id: mapping.invoice_id, installment: mapping.installment_index, planStatus: result.status });
    }

    await store.markInvoicePaid(mapping.invoice_id, 'paypal');
    console.log(`✅ [PayPal webhook] Order ${ppOrderId} captured — invoice ${mapping.invoice_id} (${mapping.client_name}) marked paid automatically.`);

    const allInvoices = [...(await store.loadUserInvoices()), ...SAMPLE_INVOICES];
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

/**
 * GET /api/history
 * The agent's activity log: every message it actually sent (or attempted,
 * or was blocked from sending by a human reject) — who to, which invoice,
 * channel, subject/body, whether it was a real send or a stub, and when.
 * Written by the Python agent (agent/memory.py, record_message_history) on
 * every approve/reject outcome in both mock and real mode; this endpoint
 * just reads it back for the History panel. Optional ?limit=N (default 100).
 */
app.get('/api/history', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const entries = await store.listMessageHistory(limit);
    res.json({ entries });
  } catch (error) {
    console.error('❌ [GET /api/history] Failed:', error);
    res.status(500).json({ error: 'Failed to load message history', details: error.message });
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
