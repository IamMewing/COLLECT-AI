const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const twilio = require('twilio');
require('dotenv').config();

const { runSweep, approveAndExecute, confirmPayment, checkReplies, confirmInstallmentPaid, getNegotiationState, handleIncomingText, handleVoiceTurn, askAssistant } = require('./agentService');
const paypalService = require('./paypalService');
const store = require('./store');
const notifications = require('./notifications');
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
// Twilio posts inbound WhatsApp/SMS messages as a classic HTML form body
// (application/x-www-form-urlencoded), not JSON — this only ever applies to
// requests with that content type, so it's a no-op for every other route.
app.use(express.urlencoded({ extended: false }));

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

// ── Invoices ────────────────────────────────────────────────────────────────
// This service used to ship three hardcoded sample invoices (Meridian, Acme,
// Apex) that were merged into every list response to exercise the graph's
// three branches. They're gone deliberately: none of them carried a real
// email or phone number, so the agent could reason about them but never
// actually send anything — which made "it works" ambiguous in exactly the
// place it most needed to be unambiguous. Every invoice here is now one a
// person actually created, through the UI or a CSV import.

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

    // This usually runs unattended on a schedule, so the feed is the only
    // place a person would ever learn a client wrote back — especially an
    // escalation, which exists precisely because the agent decided it
    // shouldn't handle something alone.
    for (const r of result.results || []) {
      if (r.status === 'escalate_to_human') {
        await notifications.record({
          kind: 'escalation',
          title: 'The agent escalated a reply to you',
          body: r.reason || 'It decided this one needs a human — a dispute, or something it shouldn’t answer on its own.',
          invoice_id: r.invoice_id,
        });
      } else if (r.status === 'resolved') {
        await notifications.record({
          kind: 'reply',
          title: 'A thread resolved itself',
          body: 'The client agreed or confirmed payment, and the agent closed the conversation.',
          invoice_id: r.invoice_id,
        });
      } else if (r.status === 'continue_negotiating') {
        await notifications.record({
          kind: 'reply',
          title: 'A client replied',
          body: 'The agent read it and wrote back — open negotiations to see the thread.',
          invoice_id: r.invoice_id,
        });
      }
    }
    for (const b of result.billed_installments || []) {
      await notifications.record({
        kind: 'installment',
        title: 'An installment came due and was billed',
        body: 'A fresh PayPal link went out for the next installment on this plan.',
        invoice_id: b.invoice_id || b?.invoice || undefined,
      });
    }

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
    res.json({ invoices: userInvoices.map(withStatus) });
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
    const allInvoices = await store.loadUserInvoices();
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
    if (b.phone && !/^\+?[0-9\s().-]{7,20}$/.test(String(b.phone).trim())) {
      return res.status(400).json({
        error: 'Invalid phone',
        details: `"${b.phone}" doesn't look like a valid phone number.`,
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
      // Same reasoning as email above, for WhatsApp/SMS outreach
      // (agent/tools/sms_tools.py) — omitted entirely when not given.
      ...(b.phone ? { phone: String(b.phone).trim() } : {}),
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
    // This used to fall back to a hardcoded sample invoice when the body
    // carried none, which quietly turned a client-side bug (forgot to send
    // the invoice) into a successful-looking run against someone else's
    // data. With no samples left there's nothing to fall back to, and
    // saying so plainly is better than inventing an invoice.
    const invoice = req.body?.invoice;
    if (!invoice || !invoice.client_name) {
      return res.status(400).json({
        error: 'No invoice to run on',
        details: 'POST an { invoice } body. Add an invoice on the ledger first if you have none.',
      });
    }
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
    const all = (await store.loadUserInvoices()).map(withStatus);

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
    const allInvoices = await store.loadUserInvoices();
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

    // Record what actually happened on the wire, not what was attempted —
    // result.status now carries send_message()'s real outcome (see
    // agent/execute.py), so a provider rejection lands in the feed as a
    // failure with the provider's own reason attached.
    if (approved) {
      const send = result?.send_result || {};
      const channel = String(send.channel_used || send.channel || finalDraft.channel || 'message');
      const label = channel.charAt(0).toUpperCase() + channel.slice(1);
      // Mock mode reports 'sent (mock)', real mode 'sent' or 'failed' — so
      // match on the prefix rather than equality, or a mock run files every
      // approval as a delivery failure.
      const delivered = String(result?.status || '').startsWith('sent');

      if (delivered && send.real_send) {
        await notifications.record({
          kind: 'sent',
          title: `${label} sent to ${client_name || 'client'}`,
          body: send.recipient ? `Delivered to ${send.recipient}.` : undefined,
          invoice_id: invoice?.invoice_id,
          client_name,
        });
      } else if (!delivered) {
        await notifications.record({
          kind: 'failed',
          title: `Couldn’t send to ${client_name || 'client'}`,
          body: send.error ? `${channel.toUpperCase()} rejected it: ${send.error}` : 'The send did not go through.',
          invoice_id: invoice?.invoice_id,
          client_name,
        });
      }
      // Deliberately silent on the third case — delivered but real_send
      // false, i.e. mock mode or no credentials configured. Nothing left
      // the server, so it isn't an event; the approval gate already says
      // "simulated only" right where the person clicked.
    }

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
      await notifications.record({
        kind: 'installment',
        title: `Installment ${mapping.installment_index} paid`,
        body: `${mapping.client_name} paid an installment via PayPal. Plan status: ${result.status}.`,
        invoice_id: mapping.invoice_id,
        client_name: mapping.client_name,
      });
      // Only the FINAL installment actually finishes the invoice.
      if (result.status === 'completed') {
        await store.markInvoicePaid(mapping.invoice_id, 'paypal');
        console.log(`✅ [PayPal webhook] All installments paid — invoice ${mapping.invoice_id} marked paid.`);
        await notifications.record({
          kind: 'payment',
          title: 'Invoice paid in full',
          body: `${mapping.client_name} finished their payment plan — every installment is settled.`,
          invoice_id: mapping.invoice_id,
          client_name: mapping.client_name,
        });
      }
      return res.status(200).json({ received: true, mapped: true, captured: true, invoice_id: mapping.invoice_id, installment: mapping.installment_index, planStatus: result.status });
    }

    await store.markInvoicePaid(mapping.invoice_id, 'paypal');
    console.log(`✅ [PayPal webhook] Order ${ppOrderId} captured — invoice ${mapping.invoice_id} (${mapping.client_name}) marked paid automatically.`);
    await notifications.record({
      kind: 'payment',
      title: 'Payment received',
      body: `${mapping.client_name} paid invoice ${mapping.invoice_id} through the PayPal link the agent sent. Closed automatically — no one had to mark it.`,
      invoice_id: mapping.invoice_id,
      client_name: mapping.client_name,
    });

    const allInvoices = await store.loadUserInvoices();
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
 * GET /api/twilio/status
 * Mirrors GET /api/paypal/status — lets the UI show whether WhatsApp/SMS is
 * actually wired up instead of silently falling back to the print-only stub
 * (see agent/tools/sms_tools.py).
 */
app.get('/api/twilio/status', auth.requireAuth, (req, res) => {
  res.json({
    configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    whatsapp_from_configured: Boolean(process.env.TWILIO_WHATSAPP_FROM),
    sms_from_configured: Boolean(process.env.TWILIO_SMS_FROM),
    // Voice calls (Phase 5) reuse the same SMS sender number as the caller
    // ID — a single Twilio number handles both SMS and Voice by default,
    // so there's no separate TWILIO_VOICE_FROM to configure.
    voice_call_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM),
    webhook_unverified_allowed: (process.env.TWILIO_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true',
  });
});

/**
 * Shared Twilio-signature verification for EVERY Twilio webhook this server
 * exposes — inbound WhatsApp/SMS below, and the three Voice webhooks
 * further down. twilio.validateRequest hashes the exact URL Twilio called
 * plus the parsed body, so this must only ever run after the body-parsing
 * middleware above has populated req.body. Same reasoning everywhere it's
 * used: anyone who finds one of these URLs could otherwise inject a fake
 * client reply, or fake their way through a live call's turns, into a real
 * negotiation thread — an unverified request is REFUSED by default, not
 * processed-with-a-warning. TWILIO_WEBHOOK_ALLOW_UNVERIFIED=true is the one
 * escape hatch, for local testing without a publicly reachable URL for
 * Twilio to actually sign against — it must never be true where any of
 * these routes are actually internet-reachable.
 */
function verifyTwilioWebhook(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const verified = Boolean(authToken) && twilio.validateRequest(authToken, signature, fullUrl, req.body || {});
  const allowUnverified = (process.env.TWILIO_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true';
  const reason = authToken
    ? 'signature verification failed'
    : 'TWILIO_AUTH_TOKEN is not set, so there is nothing to verify the signature against';
  return { verified, allowUnverified, reason };
}

/**
 * POST /api/twilio/webhook
 * Twilio calls this the moment a client replies on WhatsApp or texts the
 * configured SMS number — the push-based counterpart to the scheduled
 * /api/agent/check-replies poll for email. Every inbound message runs
 * through the exact same negotiation loop (agent/execute.py's
 * handle_incoming_reply via handle_incoming_text) that email replies do.
 */
app.post('/api/twilio/webhook', async (req, res) => {
  const respondEmptyTwiml = () => res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const { verified, allowUnverified, reason } = verifyTwilioWebhook(req);

    if (!verified) {
      if (!allowUnverified) {
        console.warn(`⛔ [Twilio webhook] Rejected (401) — ${reason}.`);
        return res.status(401).send('Signature not verified');
      }
      console.warn(
        `⚠️  [Twilio webhook] UNVERIFIED message processed anyway — ${reason}. ` +
        `TWILIO_WEBHOOK_ALLOW_UNVERIFIED is set; this must be unset wherever this server is internet-reachable.`
      );
    }

    const rawFrom = req.body?.From || '';
    const body = req.body?.Body || '';
    const channel = rawFrom.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    const fromPhone = rawFrom.replace(/^whatsapp:/, '');

    console.log(`\n💬 [Twilio webhook] Inbound ${channel} from ${fromPhone}${verified ? ' [verified]' : ' [unverified]'}`);

    if (!fromPhone || !body) {
      console.warn('⚠️  [Twilio webhook] Missing From/Body — nothing to process.');
      return respondEmptyTwiml();
    }

    const result = await handleIncomingText(fromPhone, body, channel);
    console.log(`🔁 [Twilio webhook] Negotiation loop result for ${fromPhone}:`, result.status || result.reason || result);

    // Empty TwiML: we handle the reply ourselves (asynchronously, via the
    // negotiation loop above, which may or may not send something back
    // depending on AUTO_APPROVE_NEGOTIATION) rather than letting Twilio's
    // own auto-reply mechanism send anything.
    respondEmptyTwiml();
  } catch (error) {
    console.error('❌ [Twilio webhook] Failed:', error);
    // Still respond with valid (empty) TwiML even on failure — an HTTP error
    // here just makes Twilio retry the same message later, which would
    // re-run the negotiation loop on a reply that may have partially
    // succeeded already.
    respondEmptyTwiml();
  }
});

/**
 * GET /api/whatsapp/status
 * Mirrors GET /api/twilio/status — WhatsApp now goes through Meta's own
 * Cloud API directly (agent/tools/whatsapp_tools.py) instead of Twilio, so
 * it gets its own status/config surface rather than sharing Twilio's. See
 * that module's docstring for why: a genuinely free, REST-API-usable Twilio
 * number requires upgrading to a paid account, and this project's WhatsApp
 * channel needed a path that doesn't.
 */
app.get('/api/whatsapp/status', auth.requireAuth, (req, res) => {
  res.json({
    configured: Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID),
    webhook_configured: Boolean(process.env.META_WHATSAPP_VERIFY_TOKEN),
    webhook_unverified_allowed: (process.env.META_WHATSAPP_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true',
  });
});

/**
 * GET /api/whatsapp/webhook
 * Meta's one-time "webhook verification handshake": when you register this
 * URL in the Meta App dashboard, Meta calls it with a challenge token that
 * must be echoed back verbatim, but ONLY if hub.verify_token matches the
 * arbitrary secret you chose (META_WHATSAPP_VERIFY_TOKEN) — this is how
 * Meta confirms you actually control this URL before sending it real
 * message events. See https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected) {
    console.log('✅ [WhatsApp webhook] Verification handshake succeeded.');
    return res.status(200).type('text/plain').send(challenge);
  }
  console.warn('⛔ [WhatsApp webhook] Verification handshake rejected — token mismatch or META_WHATSAPP_VERIFY_TOKEN unset.');
  return res.sendStatus(403);
});

/**
 * Verifies Meta's X-Hub-Signature-256 header — an HMAC-SHA256 of the exact
 * raw request body, keyed with the Meta app's App Secret (NOT the access
 * token). Same reasoning as verifyTwilioWebhook above: anyone who finds this
 * URL could otherwise inject a fake inbound WhatsApp message into a real
 * negotiation thread, so an unverified request is REFUSED by default.
 * META_WHATSAPP_WEBHOOK_ALLOW_UNVERIFIED=true is the one escape hatch, for
 * local testing without a publicly reachable URL for Meta to sign against.
 */
function verifyMetaWebhook(req) {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET;
  const signatureHeader = req.headers['x-hub-signature-256'] || '';
  const allowUnverified = (process.env.META_WHATSAPP_WEBHOOK_ALLOW_UNVERIFIED || '').toLowerCase() === 'true';
  const reason = appSecret
    ? 'signature verification failed'
    : 'META_WHATSAPP_APP_SECRET is not set, so there is nothing to verify the signature against';

  if (!appSecret || !req.rawBody) {
    return { verified: false, allowUnverified, reason };
  }

  const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  // timingSafeEqual needs equal-length buffers, or it throws — a mismatched
  // length just means "not verified", not a crash.
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expectedSig);
  const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { verified, allowUnverified, reason };
}

/**
 * POST /api/whatsapp/webhook
 * Meta calls this the moment a client sends a WhatsApp message to our
 * number — the direct-Meta counterpart to POST /api/twilio/webhook. Every
 * inbound message runs through the exact same negotiation loop
 * (handleIncomingText -> agent/execute.py's handle_incoming_reply) that
 * Twilio-routed replies and email replies do; only how the message got here
 * differs. See https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 * for the payload shape parsed below.
 */
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const { verified, allowUnverified, reason } = verifyMetaWebhook(req);

    if (!verified) {
      if (!allowUnverified) {
        console.warn(`⛔ [WhatsApp webhook] Rejected (401) — ${reason}.`);
        return res.status(401).json({ error: 'Webhook signature not verified', details: reason });
      }
      console.warn(
        `⚠️  [WhatsApp webhook] UNVERIFIED message processed anyway — ${reason}. ` +
        `META_WHATSAPP_WEBHOOK_ALLOW_UNVERIFIED is set; this must be unset wherever this server is internet-reachable.`
      );
    }

    // Meta always wants a fast 200 regardless of what's inside, same
    // "ack immediately, process async-in-spirit" contract as Twilio's.
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== 'text') {
      // Status callbacks (delivered/read receipts) and non-text message
      // types land here too — nothing for the negotiation loop to do with
      // those, so just acknowledge and move on.
      return res.sendStatus(200);
    }

    const fromPhone = `+${message.from}`;
    const body = message.text?.body || '';
    console.log(`\n💬 [WhatsApp webhook] Inbound whatsapp from ${fromPhone}${verified ? ' [verified]' : ' [unverified]'}`);

    if (!body) {
      return res.sendStatus(200);
    }

    const result = await handleIncomingText(fromPhone, body, 'whatsapp');
    console.log(`🔁 [WhatsApp webhook] Negotiation loop result for ${fromPhone}:`, result.status || result.reason || result);

    // An inbound WhatsApp arrives with nobody watching the server log, so
    // the feed is how a person finds out. 'skipped' means it matched no
    // active conversation — noise, not news, so it isn't recorded.
    if (result.status && result.status !== 'skipped') {
      await notifications.record({
        kind: result.status === 'escalate_to_human' ? 'escalation' : 'reply',
        title: result.status === 'escalate_to_human'
          ? 'A WhatsApp reply was escalated to you'
          : 'A client replied on WhatsApp',
        body: result.status === 'resolved'
          ? 'The agent considers this thread resolved.'
          : result.reason || 'Open negotiations to see the full thread.',
        invoice_id: result.invoice_id,
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ [WhatsApp webhook] Failed:', error);
    // Still 200 — an HTTP error here just makes Meta retry the same
    // message later, which would re-run the negotiation loop on a reply
    // that may have partially succeeded already.
    res.sendStatus(200);
  }
});

/** Looks up one invoice by id — same lookup every other per-invoice route
 *  in this file does inline; factored out once here since the three voice
 *  routes below all need it. */
async function findInvoiceById(id) {
  const allInvoices = await store.loadUserInvoices();
  return allInvoices.find((i) => i.invoice_id === id) || null;
}

/** Renders a short apologetic TwiML response and ends the call — used by
 *  the voice webhooks below whenever something is wrong enough that there's
 *  no sense continuing (invoice not found, Twilio signature rejected), but
 *  the caller is Twilio itself and needs valid TwiML back, not JSON. */
function respondVoiceError(res, message) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say(message);
  response.hangup();
  res.type('text/xml').send(response.toString());
}

/**
 * POST /api/agent/invoices/:id/call
 * Places a REAL outbound call via Twilio to the invoice's phone number —
 * triggered by a human clicking "Call them" in the dashboard (explicit
 * consent for this one call, same as clicking Approve is consent to send a
 * drafted email/text). This endpoint's only job is placing the call: it
 * tells Twilio to fetch its first turn's instructions from
 * POST /api/twilio/voice the moment the client picks up. Nothing about what
 * the agent actually SAYS happens here — that's agent/execute.py's
 * handle_voice_turn, driven entirely by Twilio re-fetching TwiML from this
 * server turn by turn (see the two webhooks below).
 *
 * Degrades gracefully when Twilio isn't configured (same pattern as every
 * other real-send path in this project): returns a 'stubbed' result instead
 * of erroring, so the rest of the demo keeps working without real
 * credentials — GET /api/twilio/status's voice_call_configured tells the UI
 * which case to expect before it even tries.
 */
app.post('/api/agent/invoices/:id/call', agentLimiter, async (req, res) => {
  const { id } = req.params;
  try {
    const invoice = await findInvoiceById(id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found', details: id });
    }
    if (!invoice.phone) {
      return res.status(400).json({ error: 'No phone on file', details: `${id} has no phone number — add one before calling.` });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const callerId = process.env.TWILIO_SMS_FROM; // same number handles SMS + Voice

    if (!accountSid || !authToken || !callerId) {
      console.log(`\n📞 [POST /api/agent/invoices/${id}/call] (stub — Twilio not configured) Would call ${invoice.phone}.`);
      return res.json({ status: 'stubbed', real_call: false, recipient: invoice.phone, call_sid: null });
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const voiceUrl = `${base}/api/twilio/voice?invoice_id=${encodeURIComponent(id)}`;
    const statusCallbackUrl = `${base}/api/twilio/voice/status?invoice_id=${encodeURIComponent(id)}`;

    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: invoice.phone,
      from: callerId,
      url: voiceUrl,
      status_callback: statusCallbackUrl,
      status_callback_event: ['completed'],
    });

    console.log(`\n📞 [POST /api/agent/invoices/${id}/call] Real call placed to ${invoice.phone}, sid=${call.sid}`);
    res.json({ status: call.status || 'queued', real_call: true, recipient: invoice.phone, call_sid: call.sid });
  } catch (error) {
    console.error(`❌ [POST /api/agent/invoices/${id}/call] Failed:`, error);
    res.status(500).json({ error: 'Failed to place call', details: error.message });
  }
});

/**
 * POST /api/twilio/voice
 * Twilio fetches this the instant the client answers — the call's opening
 * turn. Signature-verified like every other Twilio webhook here. Looks up
 * the invoice (from the ?invoice_id= query param this server itself put on
 * the url when placing the call above) and asks the Python bridge what the
 * agent's opening line should be (agent/execute.py's handle_voice_turn with
 * transcript=null). Speaks that line, then <Gather>s for the client's
 * response — actionOnEmptyResult="true" means even silence routes back to
 * POST /api/twilio/voice/gather below, so that one webhook is the single
 * place "what did the client say, if anything" gets handled.
 */
app.post('/api/twilio/voice', async (req, res) => {
  try {
    const { verified, allowUnverified, reason } = verifyTwilioWebhook(req);
    if (!verified && !allowUnverified) {
      console.warn(`⛔ [Twilio voice] Rejected (401) — ${reason}.`);
      return res.status(401).send('Signature not verified');
    }
    if (!verified) {
      console.warn(`⚠️  [Twilio voice] UNVERIFIED call processed anyway — ${reason}.`);
    }

    const invoiceId = req.query.invoice_id;
    if (!invoiceId) {
      return respondVoiceError(res, 'Sorry, this call was not set up correctly. Goodbye.');
    }
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      return respondVoiceError(res, 'Sorry, I could not find that invoice on file. Goodbye.');
    }

    const result = await handleVoiceTurn(invoiceId, null, invoice);
    console.log(`\n📞 [Twilio voice] Opening turn for ${invoiceId}: "${result.say}"`);

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say({ voice: 'Polly.Joanna' }, result.say);
    if (result.continue) {
      response.gather({
        input: 'speech',
        action: `/api/twilio/voice/gather?invoice_id=${encodeURIComponent(invoiceId)}`,
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 6,
        actionOnEmptyResult: true,
      });
    } else {
      response.hangup();
    }
    res.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('❌ [Twilio voice] Failed:', error);
    respondVoiceError(res, "Sorry, I'm having trouble on my end. I'll follow up another way. Goodbye.");
  }
});

/**
 * POST /api/twilio/voice/gather
 * Twilio posts here after every <Gather> on the call — with a SpeechResult
 * if it caught something, or with no SpeechResult at all if the client said
 * nothing before the timeout (actionOnEmptyResult="true" above is what
 * makes silence reach this webhook too, instead of Twilio just hanging up
 * on its own). A silent turn is handled right here, with no Python/LLM call
 * at all — one re-prompt via ?retry=1, then a graceful hangup — so saying
 * nothing never burns part of the conversation's turn budget
 * (agent/execute.py's MAX_VOICE_TURNS). An actual transcript goes through
 * handle_voice_turn exactly like every other turn.
 */
app.post('/api/twilio/voice/gather', async (req, res) => {
  try {
    const { verified, allowUnverified, reason } = verifyTwilioWebhook(req);
    if (!verified && !allowUnverified) {
      console.warn(`⛔ [Twilio voice/gather] Rejected (401) — ${reason}.`);
      return res.status(401).send('Signature not verified');
    }
    if (!verified) {
      console.warn(`⚠️  [Twilio voice/gather] UNVERIFIED call processed anyway — ${reason}.`);
    }

    const invoiceId = req.query.invoice_id;
    const speechResult = req.body?.SpeechResult;
    const VoiceResponse = twilio.twiml.VoiceResponse;

    if (!invoiceId) {
      return respondVoiceError(res, 'Sorry, this call was not set up correctly. Goodbye.');
    }

    if (!speechResult) {
      if (req.query.retry) {
        console.log(`\n📞 [Twilio voice/gather] Still silent for ${invoiceId} after a re-prompt — hanging up.`);
        const response = new VoiceResponse();
        response.say("No worries — I'll follow up by text instead. Goodbye.");
        response.hangup();
        return res.type('text/xml').send(response.toString());
      }
      console.log(`\n📞 [Twilio voice/gather] Nothing heard for ${invoiceId} — re-prompting once.`);
      const response = new VoiceResponse();
      response.say("Sorry, I didn't catch that — could you say that again?");
      response.gather({
        input: 'speech',
        action: `/api/twilio/voice/gather?invoice_id=${encodeURIComponent(invoiceId)}&retry=1`,
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 6,
        actionOnEmptyResult: true,
      });
      return res.type('text/xml').send(response.toString());
    }

    const invoice = await findInvoiceById(invoiceId);
    const result = await handleVoiceTurn(invoiceId, speechResult, invoice);
    console.log(`\n📞 [Twilio voice/gather] ${invoiceId} client said: "${speechResult}" — agent: "${result.say}"`);

    const response = new VoiceResponse();
    response.say({ voice: 'Polly.Joanna' }, result.say);
    if (result.continue) {
      response.gather({
        input: 'speech',
        action: `/api/twilio/voice/gather?invoice_id=${encodeURIComponent(invoiceId)}`,
        method: 'POST',
        speechTimeout: 'auto',
        timeout: 6,
        actionOnEmptyResult: true,
      });
    } else {
      response.hangup();
    }
    res.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('❌ [Twilio voice/gather] Failed:', error);
    respondVoiceError(res, "Sorry, I'm having trouble on my end. I'll follow up another way. Goodbye.");
  }
});

/**
 * POST /api/twilio/voice/status
 * Twilio's call-status callback (statusCallbackEvent=['completed'] when the
 * call was placed above) — logging only, so a completed/failed/no-answer
 * call shows up in server logs even though nothing about it needs to
 * change application state. No TwiML needed since this never drives the
 * call itself.
 */
app.post('/api/twilio/voice/status', (req, res) => {
  const { verified, allowUnverified, reason } = verifyTwilioWebhook(req);
  if (!verified && !allowUnverified) {
    console.warn(`⛔ [Twilio voice/status] Rejected (401) — ${reason}.`);
    return res.status(401).send('Signature not verified');
  }
  const invoiceId = req.query.invoice_id;
  console.log(
    `\n📞 [Twilio voice/status] ${invoiceId || '(unknown invoice)'}: ` +
    `status=${req.body?.CallStatus || '?'} duration=${req.body?.CallDuration || '?'}s`
  );
  res.sendStatus(200);
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

/**
 * GET /api/agent/negotiations
 * Read-only snapshot of every tracked conversation thread and payment plan
 * (agent/memory.py's conversations/payment_plans stores) — what the UI's
 * negotiation panel polls so a judge can actually watch a conversation and
 * a plan's installments progress, instead of inferring it from scattered
 * History-panel rows. Never triggers anything (unlike check-replies below).
 */
app.get('/api/agent/negotiations', async (req, res) => {
  try {
    const state = await getNegotiationState();
    res.json(state);
  } catch (error) {
    console.error('❌ [GET /api/agent/negotiations] Failed:', error);
    res.status(error.status || 500).json({
      error: error.error || 'Failed to load negotiation state',
      details: error.details || error.message || 'Unknown error occurred',
    });
  }
});

// ── Floating assistant ──────────────────────────────────────────────────────
/**
 * POST /api/agent/assistant
 * A plain-language question about the portfolio, answered from this
 * deployment's real data. Read-only by construction: the agent behind it
 * has no tools, so the worst a prompt injection in an invoice's client name
 * could achieve is a misleading sentence, not an action.
 *
 * Shares agentLimiter with sweep/approve rather than getting its own budget
 * — it's the same metered model spend out of the same shared key, and a
 * chat box is the easiest of all of these to hammer.
 */
app.post('/api/agent/assistant', agentLimiter, async (req, res) => {
  try {
    const question = (req.body?.question || '').toString().trim();
    if (!question) {
      return res.status(400).json({ error: 'No question', details: 'Send a { question } string.' });
    }
    if (question.length > 1000) {
      return res.status(400).json({ error: 'Question too long', details: 'Keep it under 1000 characters.' });
    }

    const statusMap = await store.loadInvoiceStatus();
    const invoices = (await store.loadUserInvoices()).map((inv) => ({
      ...inv,
      ...normalizeStatusEntry(statusMap[inv.invoice_id]),
    }));

    const result = await askAssistant(question, invoices);
    res.json(result);
  } catch (error) {
    console.error('❌ [POST /api/agent/assistant] Failed:', error);
    res.status(error.status || 500).json({
      error: error.error || 'The assistant could not answer',
      details: error.details || error.message || 'Unknown error occurred',
      stderr: error.stderr || null,
    });
  }
});

// ── Notifications ───────────────────────────────────────────────────────────
// The feed behind the bell in the nav. Written to from the real events
// elsewhere in this file (PayPal captures, sends succeeding/failing, replies
// the agent handled); read from here.

app.get('/api/notifications', auth.requireAuth, async (req, res) => {
  try {
    const list = await notifications.list(50);
    res.json({ notifications: list, unread_count: list.filter((n) => !n.read).length });
  } catch (error) {
    console.error('❌ [GET /api/notifications] Failed:', error);
    res.status(500).json({ error: 'Failed to load notifications', details: error.message });
  }
});

app.post('/api/notifications/read', auth.requireAuth, async (req, res) => {
  try {
    await notifications.markAllRead();
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ [POST /api/notifications/read] Failed:', error);
    res.status(500).json({ error: 'Failed to mark notifications read', details: error.message });
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
