// ============================================
// CollectAI — Firebase / Firestore Configuration
// ============================================

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

let db;

function initializeFirebase() {
  if (db) return db;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT;
  const hasCredFile = credPath && fs.existsSync(path.resolve(credPath));
  const hasRealProjectId = projectId && projectId !== 'your-firebase-project-id';

  try {
    if (admin.apps.length === 0) {
      if (rawServiceAccount) {
        let parsed;
        try {
          parsed = JSON.parse(rawServiceAccount);
        } catch {
          parsed = JSON.parse(Buffer.from(rawServiceAccount, 'base64').toString('utf8'));
        }
        admin.initializeApp({
          credential: admin.credential.cert(parsed),
          projectId: parsed.project_id || projectId
        });
      } else if (privateKey && clientEmail) {
        const formattedKey = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: projectId,
            clientEmail: clientEmail,
            privateKey: formattedKey
          }),
          projectId
        });
      } else if (hasCredFile) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId
        });
      } else if (hasRealProjectId) {
        admin.initializeApp({ projectId });
      } else {
        throw new Error('Firebase environment variables missing or unconfigured. Real Firebase project configuration required.');
      }
    }

    db = getFirestore(admin.apps[0], 'default');
    db.settings({ ignoreUndefinedProperties: true });
    console.log('✅ Production Firebase/Firestore initialized successfully');
    return db;
  } catch (error) {
    console.error('❌ Critical Firebase initialization failed:', error.message);
    throw new Error(`Firebase initialization error: ${error.message}`);
  }
}

function getDb() {
  if (!db) {
    initializeFirebase();
  }
  return db;
}

// Collection name constants
const COLLECTIONS = {
  BUSINESSES: 'workspaces', // Standardize on 'workspaces' collection to match client side writes
  INVOICES: 'invoices',
  AGENT_ACTIONS: 'activities', // Standardize on 'activities' collection to match client writes
  PAYMENTS: 'payments'
};

module.exports = { initializeFirebase, getDb, COLLECTIONS };
