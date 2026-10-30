/**
 * paypalService: thin wrapper around PayPal's REST APIs (sandbox by default).
 *
 * This is the piece that turns CollectAI from "an agent that drafts emails"
 * into agentic commerce: when a human approves the agent's drafted message,
 * this module creates and sends a REAL PayPal (sandbox) invoice, and the
 * payment link is woven into the message itself. A PayPal webhook later
 * confirms payment and closes the loop automatically (see server.js).
 *
 * Required env vars (see .env.example):
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_ENV              'sandbox' (default) or 'live'
 *   PAYPAL_WEBHOOK_ID       set once you've created a webhook in the Developer
 *                           Dashboard — used to verify incoming webhook calls
 *
 * Every function here fails soft where it reasonably can: if PayPal isn't
 * configured, isConfigured() returns false and callers fall back to the
 * existing stub flow instead of crashing the approve step.
 */

const BASE_URL =
  (process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

function isConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function assertFetch() {
  if (typeof fetch !== 'function') {
    throw new Error(
      'global fetch is not available — paypalService requires Node.js 18+. ' +
        `Current version: ${process.version}`
    );
  }
}

// ── OAuth2 client-credentials token, cached until ~60s before expiry ────────
let cachedToken = null; // { access_token, expires_at }

async function getAccessToken() {
  assertFetch();
  if (!isConfigured()) {
    throw new Error('PayPal is not configured — set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  const basicAuth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PayPal OAuth token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.access_token;
}

async function ppFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`PayPal API ${options.method || 'GET'} ${path} failed (${res.status}): ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  // 204 No Content (e.g. the /send endpoint) has no JSON body
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Create a draft invoice in the merchant's PayPal sandbox account.
 * Returns the PayPal invoice id (not the full href).
 */
async function createInvoice({ invoiceId, clientName, clientEmail, amount, currency = 'USD', note }) {
  const body = {
    detail: {
      invoice_number: invoiceId,
      currency_code: currency,
      note: note || `CollectAI follow-up for invoice ${invoiceId}`,
      payment_term: { term_type: 'NET_10' },
    },
    invoicer: {
      name: { given_name: 'CollectAI', surname: 'Accounts' },
      email_address: process.env.PAYPAL_MERCHANT_EMAIL || undefined,
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: clientName || 'Valued Client' },
          email_address: clientEmail,
        },
      },
    ],
    items: [
      {
        name: `Invoice ${invoiceId}`,
        quantity: '1',
        unit_amount: { currency_code: currency, value: Number(amount).toFixed(2) },
      },
    ],
  };

  const res = await ppFetch('/v2/invoicing/invoices', { method: 'POST', body: JSON.stringify(body) });
  // Response has { href: ".../v2/invoicing/invoices/{id}" }
  const ppInvoiceId = res.href ? res.href.split('/').filter(Boolean).pop() : res.id;
  return ppInvoiceId;
}

/** Sends a draft invoice to its recipient. PayPal returns 202/204 with no body. */
async function sendInvoice(ppInvoiceId) {
  await ppFetch(`/v2/invoicing/invoices/${ppInvoiceId}/send`, {
    method: 'POST',
    body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }),
  });
}

/** Fetches full invoice detail, including the payer-facing payment link. */
async function getInvoice(ppInvoiceId) {
  return ppFetch(`/v2/invoicing/invoices/${ppInvoiceId}`, { method: 'GET' });
}

/**
 * Full flow: create -> send -> fetch back the payer-facing link.
 * Returns { paypalInvoiceId, paymentLink, status }.
 */
async function createAndSendInvoice({ invoiceId, clientName, clientEmail, amount, currency, note }) {
  const paypalInvoiceId = await createInvoice({ invoiceId, clientName, clientEmail, amount, currency, note });
  await sendInvoice(paypalInvoiceId);
  const detail = await getInvoice(paypalInvoiceId);
  const paymentLink =
    detail?.detail?.metadata?.recipient_view_url ||
    detail?.detail?.metadata?.recipientViewUrl ||
    null;
  return { paypalInvoiceId, paymentLink, status: detail?.status || 'SENT' };
}

/**
 * Verifies a webhook call actually came from PayPal, using the headers
 * PayPal sends with every webhook POST plus PAYPAL_WEBHOOK_ID.
 * Returns true/false. If PAYPAL_WEBHOOK_ID isn't set, returns false and
 * callers should treat the event as unverified (log it, don't act on it
 * blindly) rather than crash.
 */
async function verifyWebhookSignature(headers, rawBodyString) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;

  let eventBody;
  try {
    eventBody = JSON.parse(rawBodyString);
  } catch {
    return false;
  }

  const verifyBody = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: eventBody,
  };

  try {
    const res = await ppFetch('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify(verifyBody),
    });
    return res?.verification_status === 'SUCCESS';
  } catch (e) {
    console.error('[paypalService] Webhook signature verification failed:', e.message);
    return false;
  }
}

module.exports = {
  isConfigured,
  getAccessToken,
  createInvoice,
  sendInvoice,
  getInvoice,
  createAndSendInvoice,
  verifyWebhookSignature,
};
