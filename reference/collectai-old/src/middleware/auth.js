// ============================================
// CollectAI — Express Auth Middleware
// ============================================

const admin = require('firebase-admin');
const { initializeFirebase } = require('../config/firebase');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let idToken = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
    } else if (req.query.token) {
      idToken = req.query.token;
    }

    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required (Bearer token missing)' });
    }

    if (admin.apps.length === 0) {
      try {
        initializeFirebase();
      } catch (err) {
        console.error('❌ Firebase Admin SDK is not initialized. Cannot verify authentication token. Reason:', err.message);
        return res.status(503).json({ error: 'Service Unavailable: Authentication service is offline' });
      }
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.userId = decodedToken.uid;
      next();
    } catch (authError) {
      console.warn('⚠️ Firebase token verification failed:', authError.message);
      return res.status(401).json({ error: `Unauthorized: Invalid or expired authentication token (${authError.code || 'unknown'})` });
    }
  } catch (error) {
    console.error('Internal auth error:', error);
    res.status(500).json({ error: 'Internal auth error' });
  }
}

module.exports = { requireAuth };
