/**
 * AgentService: Node.js wrapper that invokes the Python Strands Agent bridge.
 * Captures stdout and stderr to guarantee transparent, debuggable error reporting.
 */

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_SCRIPT = path.join(__dirname, 'agent_bridge.py');
// Use python from environment (or PYTHON_PATH if configured)
const PYTHON_CMD = process.env.PYTHON_PATH || 'python';

/**
 * A failed real-mode sweep can produce tens of KB of stderr: every retry
 * wrapper warning (3 attempts × however many parallel nodes) plus the full
 * Python traceback, all before the actual raised exception. That belongs in
 * Cloud Run's logs (still captured there via console.error below), not in
 * the response body — a client that renders `details` verbatim has no
 * reason to expect it could be that large, and it was never meant to be
 * read as a wall of text in a UI toast.
 *
 * This finds the LAST point in the text that looks like a raised exception
 * ("some.module.SomeError: message") and keeps everything from there,
 * capped. Searching the whole blob rather than splitting on '\n' first
 * matters here: a dict repr'd into an error message (as the Gemini SDK
 * does) embeds its own literal "\n" as text, not a real line break, so a
 * line-based search can walk straight past the actual exception. Falls
 * back to the last non-empty line if no exception marker is found at all.
 * Either way the result is hard-capped, so a parsing miss on some future
 * error shape still can't reproduce the original wall-of-text bug.
 */
function summarizeStderr(stderr) {
  if (!stderr) return null;
  const cap = (s) => (s.length > 600 ? s.slice(0, 600) + '…' : s);
  const matches = [...stderr.matchAll(/[\w.]*(?:Error|Exception):/g)];
  if (matches.length > 0) {
    return cap(stderr.slice(matches[matches.length - 1].index).trim());
  }
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return cap(lines[lines.length - 1] || stderr.trim());
}

/**
 * Execute an action against the Python agent bridge.
 *
 * @param {string} action - 'sweep' | 'approve'
 * @param {object} payload - Action parameters
 * @returns {Promise<object>} Parsed JSON response from agent bridge
 */
function callAgentBridge(action, payload) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      MODEL_PROVIDER: process.env.MODEL_PROVIDER || 'gemini',
      ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.USE_MOCK !== undefined ? { USE_MOCK: process.env.USE_MOCK } : {}),
      ...(process.env.COLLECT_AI_MOCK !== undefined ? { COLLECT_AI_MOCK: process.env.COLLECT_AI_MOCK } : {}),
    };

    const child = spawn(PYTHON_CMD, [BRIDGE_SCRIPT], {
      cwd: __dirname,
      env: childEnv,
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      reject({
        status: 500,
        error: `Failed to spawn Python process: ${err.message}`,
        details: 'Check that Python is installed and accessible via PATH.',
        stderr: stderrData.trim() || err.message,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const fullStderr = stderrData.trim();
        // Full output still goes to Cloud Run logs for real debugging —
        // only the trimmed summary goes to the client.
        console.error(`🔴 [AgentService] Error in action '${action}':\n`, fullStderr || `exit code ${code}`);

        return reject({
          status: 500,
          error: `Strands Agent execution failed (exit code ${code})`,
          details: summarizeStderr(fullStderr) || `Python process exited with code ${code}`,
          stderr: null,
          action,
        });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        resolve(parsed);
      } catch (parseErr) {
        // Full stdout/stderr go to Cloud Run logs; the client gets the
        // parse error message only — same reasoning as the exit-code branch
        // above, stdout here can be arbitrarily large too.
        console.error('🔴 [AgentService] Failed to parse Python stdout as JSON:', stdoutData);
        reject({
          status: 500,
          error: 'Invalid JSON response from Strands Agent bridge',
          details: parseErr.message,
          stderr: null,
        });
      }
    });

    // Write input request to Python stdin
    const inputMessage = JSON.stringify({ action, payload });
    child.stdin.write(inputMessage);
    child.stdin.end();
  });
}

/**
 * Run risk assessment, probability prediction, and sweep on an invoice.
 * @param {object} invoice
 */
async function runSweep(invoice) {
  return callAgentBridge('sweep', { invoice });
}

/**
 * Execute approval decision on a drafted message.
 * @param {object} draft - { subject, body, channel }
 * @param {boolean} approved
 * @param {string|null} editedBody - Optional human-edited body
 * @param {string|null} clientName - Optional client name
 */
async function approveAndExecute(draft, approved, editedBody = null, clientName = null, invoice = null) {
  return callAgentBridge('approve', {
    draft,
    approved,
    edited_body: editedBody,
    client_name: clientName,
    invoice,
  });
}

/**
 * Closes the loop: called when a PayPal webhook confirms an invoice was
 * actually paid. Runs the agent's reflection (real LLM reasoning, or a
 * deterministic mock-mode equivalent) and updates persistent client memory —
 * a real payment event driving the agent's state, not a human checkbox.
 *
 * @param {string|null} clientName
 * @param {object|null} invoice
 */
async function confirmPayment(clientName, invoice = null) {
  return callAgentBridge('payment_confirmed', {
    client_name: clientName,
    invoice,
  });
}

/**
 * Polls the inbox for client replies and runs each one through the
 * autonomous negotiation loop. Meant to be called on a schedule (Cloud
 * Scheduler hitting /api/agent/check-replies), not from the UI directly.
 */
async function checkReplies() {
  return callAgentBridge('check_replies', {});
}

/**
 * Called by the PayPal webhook handler when a captured order is tagged
 * 'plan_installment' (see agent/tools/paypal_tools.py) — marks just that
 * one installment paid instead of closing out the whole invoice, which is
 * what confirmPayment above does for a single full-invoice order.
 *
 * @param {string} invoiceId
 * @param {number} installmentIndex
 * @param {string|null} paypalOrderId
 */
async function confirmInstallmentPaid(invoiceId, installmentIndex, paypalOrderId = null) {
  return callAgentBridge('installment_paid', {
    invoice_id: invoiceId,
    installment_index: installmentIndex,
    paypal_order_id: paypalOrderId,
  });
}

/**
 * Read-only snapshot of every tracked conversation thread and payment plan,
 * for the UI's negotiation panel (GET /api/agent/negotiations). Never
 * changes anything server-side, unlike checkReplies/confirmInstallmentPaid.
 */
async function getNegotiationState() {
  return callAgentBridge('negotiation_state', {});
}

/**
 * Called by POST /api/twilio/webhook for every inbound WhatsApp/SMS message
 * — the push-based counterpart to checkReplies' scheduled IMAP poll. Resolves
 * which invoice the text belongs to (by an [INV-XXXX] tag in the body, or by
 * matching the sender's phone against a tracked conversation) and runs it
 * through the same negotiation loop email replies use.
 *
 * @param {string} fromPhone - E.164 sender number, 'whatsapp:' prefix already stripped.
 * @param {string} body - The message text.
 * @param {string} channel - 'whatsapp' | 'sms'.
 */
async function handleIncomingText(fromPhone, body, channel) {
  return callAgentBridge('incoming_text', { from_phone: fromPhone, body, channel });
}

module.exports = {
  runSweep,
  approveAndExecute,
  confirmPayment,
  checkReplies,
  confirmInstallmentPaid,
  getNegotiationState,
  handleIncomingText,
};
