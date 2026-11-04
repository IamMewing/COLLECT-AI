/**
 * store.js — persistence for invoices, invoice status, the PayPal
 * order→invoice mapping, and (read-only, for the History UI) the
 * sent-message log the Python agent writes.
 *
 * FIRESTORE_ENABLED=true switches every function here to Firestore, which
 * is the only one of these two backends that actually survives a Cloud Run
 * cold start or works correctly across multiple concurrent instances —
 * local JSON files do neither, they're just whatever's on this particular
 * container's disk right now. The flag defaults off so local dev, and any
 * deployment that hasn't set up a Firestore database yet, behave exactly
 * like before this module existed: everything in server/*.json.
 *
 * Every exported function is async regardless of which backend is active,
 * so callers don't need to know or care which one they're talking to.
 */

const fs = require('fs');
const path = require('path');

const FIRESTORE_ENABLED = (process.env.FIRESTORE_ENABLED || '').trim().toLowerCase() === 'true';

let firestoreDb = null;
if (FIRESTORE_ENABLED) {
  try {
    // Required only when FIRESTORE_ENABLED=true — see server/package.json.
    // eslint-disable-next-line global-require
    const { Firestore } = require('@google-cloud/firestore');
    firestoreDb = new Firestore();
    console.log('🔥 [Store] FIRESTORE_ENABLED=true — using Firestore for invoices, status, and PayPal order mapping.');
  } catch (e) {
    console.error(
      `🔴 [Store] FIRESTORE_ENABLED=true but Firestore client init failed (${e.message}). ` +
      `Falling back to local JSON files — this will NOT survive a Cloud Run cold start.`
    );
    firestoreDb = null;
  }
}

// `new Firestore()` is lazy — it does NOT validate credentials or discover
// a project id synchronously, so a missing/bad config does not throw above;
// it only surfaces on the first real call (.get()/.set()/...), as an
// unhandled rejection that would otherwise crash the whole process. Every
// Firestore call below is therefore wrapped in try/catch that routes
// through this, which turns Firestore off for the rest of the process (so
// we don't pay a failed call's latency, or risk the same crash, on every
// subsequent request to an already-known-broken backend) and falls back to
// the local JSON files.
let firestoreFailureLogged = false;
function disableFirestore(e) {
  firestoreDb = null;
  if (!firestoreFailureLogged) {
    firestoreFailureLogged = true;
    console.error(
      `🔴 [Store] Firestore operation failed at runtime (${e.message}). ` +
      `Falling back to local JSON files for the rest of this process's lifetime.`
    );
  }
}

// ── Local JSON fallback paths — unchanged from before this module existed ──
const USER_INVOICES_PATH = path.join(__dirname, 'user_invoices.json');
const INVOICE_STATUS_PATH = path.join(__dirname, 'invoice_status.json');
const PAYPAL_ORDERS_PATH = path.join(__dirname, 'paypal_orders.json');
// Written by the Python agent (agent/memory.py's local-fallback path, same
// FIRESTORE_ENABLED flag) — Node only ever reads this one, for /api/history.
const MESSAGE_HISTORY_PATH = path.join(__dirname, '..', 'agent', 'data', 'message_history.json');

function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`Could not read ${filePath}:`, e.message);
  }
  return fallback;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── User-created invoices ───────────────────────────────────────────────────

async function loadUserInvoices() {
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('user_invoices').orderBy('_createdAt', 'desc').get();
      return snap.docs.map((d) => {
        const { _createdAt, ...invoice } = d.data();
        return invoice;
      });
    } catch (e) {
      disableFirestore(e);
    }
  }
  return readJson(USER_INVOICES_PATH, []);
}

/** Adds one new invoice. Firestore: a single doc keyed by invoice_id (so a
 *  retried create with the same id overwrites rather than duplicating).
 *  Local fallback: same read-modify-write-the-whole-file behavior as before. */
async function saveNewInvoice(invoice) {
  if (firestoreDb) {
    try {
      await firestoreDb.collection('user_invoices').doc(invoice.invoice_id).set({
        ...invoice,
        _createdAt: Date.now(),
      });
      return;
    } catch (e) {
      disableFirestore(e);
    }
  }
  const list = readJson(USER_INVOICES_PATH, []);
  list.unshift(invoice);
  writeJson(USER_INVOICES_PATH, list);
}

// ── Invoice status (paid/active), tracked separately by invoice_id so it
// applies uniformly to both curated SAMPLE_INVOICES and user-created ones ──

async function loadInvoiceStatus() {
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('invoice_status').get();
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      return map;
    } catch (e) {
      disableFirestore(e);
    }
  }
  return readJson(INVOICE_STATUS_PATH, {});
}

/** Marks an invoice paid and persists it — shared by the human "mark paid"
 *  button and the PayPal webhook handler, so both paths behave identically.
 *  Records *how* it was closed ('manual' vs 'paypal') so the UI can show the
 *  closed-loop story, not just a flat paid/unpaid flag. */
async function markInvoicePaid(invoiceId, via = 'manual') {
  const entry = { status: 'paid', via, at: new Date().toISOString() };
  if (firestoreDb) {
    try {
      await firestoreDb.collection('invoice_status').doc(invoiceId).set(entry);
      return;
    } catch (e) {
      disableFirestore(e);
    }
  }
  const map = readJson(INVOICE_STATUS_PATH, {});
  map[invoiceId] = entry;
  writeJson(INVOICE_STATUS_PATH, map);
}

// ── PayPal order mapping: paypal_order_id -> { invoice_id, client_name } ────
// This is how an incoming webhook (which only knows PayPal's order id) finds
// its way back to our internal invoice record.

async function getPaypalOrderMapping(paypalOrderId) {
  if (firestoreDb) {
    try {
      const doc = await firestoreDb.collection('paypal_orders').doc(paypalOrderId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      disableFirestore(e);
    }
  }
  const map = readJson(PAYPAL_ORDERS_PATH, {});
  return map[paypalOrderId] || null;
}

async function savePaypalOrderMapping(paypalOrderId, mapping) {
  if (firestoreDb) {
    try {
      await firestoreDb.collection('paypal_orders').doc(paypalOrderId).set(mapping);
      return;
    } catch (e) {
      disableFirestore(e);
    }
  }
  const map = readJson(PAYPAL_ORDERS_PATH, {});
  map[paypalOrderId] = mapping;
  writeJson(PAYPAL_ORDERS_PATH, map);
}

// ── Message history — the Python agent is the only writer (agent/memory.py,
// record_message_history); this is read-only from Node, for the UI's
// History panel. Same backend/flag, so both sides agree on where it lives. ──

async function listMessageHistory(limit = 100) {
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('message_history').orderBy('timestamp', 'desc').limit(limit).get();
      return snap.docs.map((d) => d.data());
    } catch (e) {
      disableFirestore(e);
    }
  }
  const history = readJson(MESSAGE_HISTORY_PATH, []);
  return history.slice().reverse().slice(0, limit);
}

module.exports = {
  // A getter, not a static value: firestoreDb can flip to null at runtime
  // (see disableFirestore), and this must reflect that, not just the value
  // at require()-time.
  get firestoreEnabled() { return Boolean(firestoreDb); },
  loadUserInvoices,
  saveNewInvoice,
  loadInvoiceStatus,
  markInvoicePaid,
  getPaypalOrderMapping,
  savePaypalOrderMapping,
  listMessageHistory,
};
