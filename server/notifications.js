/**
 * notifications.js — the event feed behind the bell in the nav.
 *
 * Same two-backend shape as store.js (Firestore when FIRESTORE_ENABLED=true,
 * a local JSON file otherwise) and for the same reason: a notification that
 * only exists on one Cloud Run container's disk is worse than no
 * notification, because it appears and disappears depending on which
 * instance served the poll.
 *
 * Every notification here is written from something that actually happened
 * on the wire — a PayPal capture, a real send succeeding or failing, an
 * inbound reply the agent handled. Nothing writes a notification
 * speculatively ("about to send…"), because a feed you can't trust to mean
 * something is one people stop reading.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIRESTORE_ENABLED = (process.env.FIRESTORE_ENABLED || '').trim().toLowerCase() === 'true';
const LOCAL_PATH = path.join(__dirname, 'notifications.json');

/** Keeps the local JSON file (and the memory it's parsed into) bounded. The
 *  Firestore path doesn't need this — it reads with .limit() — but the file
 *  would otherwise grow forever on a long-lived local run. */
const MAX_STORED = 200;

let firestoreDb = null;
if (FIRESTORE_ENABLED) {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    firestoreDb = new Firestore();
  } catch (e) {
    console.error(`🔴 [Notifications] Firestore init failed (${e.message}); using local JSON.`);
    firestoreDb = null;
  }
}

let failureLogged = false;
function disableFirestore(e) {
  firestoreDb = null;
  if (!failureLogged) {
    failureLogged = true;
    console.error(`🔴 [Notifications] Firestore failed at runtime (${e.message}); using local JSON from here on.`);
  }
}

function readLocal() {
  try {
    if (fs.existsSync(LOCAL_PATH)) return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf-8'));
  } catch (e) {
    console.error(`Could not read ${LOCAL_PATH}:`, e.message);
  }
  return [];
}

function writeLocal(list) {
  try {
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(list.slice(0, MAX_STORED), null, 2));
  } catch (e) {
    console.error(`Could not write ${LOCAL_PATH}:`, e.message);
  }
}

/**
 * Records one notification. Never throws: a failure to record that a
 * payment arrived must not also fail the webhook that was telling us about
 * it, so every caller can fire-and-forget this.
 *
 * @param {{kind: string, title: string, body?: string, invoice_id?: string, client_name?: string}} n
 */
async function record(n) {
  const entry = {
    id: crypto.randomUUID(),
    kind: n.kind || 'info',
    title: n.title,
    body: n.body || null,
    invoice_id: n.invoice_id || null,
    client_name: n.client_name || null,
    at: new Date().toISOString(),
    read: false,
  };

  try {
    if (firestoreDb) {
      try {
        await firestoreDb.collection('notifications').doc(entry.id).set(entry);
        return entry;
      } catch (e) {
        disableFirestore(e);
      }
    }
    const list = readLocal();
    list.unshift(entry);
    writeLocal(list);
  } catch (e) {
    console.error('🔴 [Notifications] Could not record notification:', e.message);
  }
  return entry;
}

async function list(limit = 50) {
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('notifications').orderBy('at', 'desc').limit(limit).get();
      return snap.docs.map((d) => d.data());
    } catch (e) {
      disableFirestore(e);
    }
  }
  return readLocal().slice(0, limit);
}

/** Marks everything read. There's one shared operator view here (the
 *  password gate is a single shared secret, not per-user accounts), so
 *  per-notification read state would be a distinction without a
 *  difference — opening the page clears the badge for everyone. */
async function markAllRead() {
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('notifications').where('read', '==', false).limit(400).get();
      if (snap.empty) return;
      // One batch, not N round-trips — a demo that's been running a while
      // can easily have a few dozen unread at once.
      const batch = firestoreDb.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
      await batch.commit();
      return;
    } catch (e) {
      disableFirestore(e);
    }
  }
  writeLocal(readLocal().map((n) => ({ ...n, read: true })));
}

module.exports = { record, list, markAllRead };
