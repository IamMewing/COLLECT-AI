// ============================================
// CollectAI — Firebase SDK (Production)
// Single initialization point. No mocks. No fallbacks.
// All config values read exclusively from import.meta.env (client/.env)
// ============================================

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// ─── Validate environment ───────────────────────────────────────────────────

const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const missing = requiredVars.filter(
  (v) => !import.meta.env[v] || import.meta.env[v] === ''
);

if (missing.length > 0) {
  const msg = `[CollectAI] Firebase configuration is incomplete.\nMissing env vars: ${missing.join(', ')}\nEnsure client/.env exists and contains all VITE_FIREBASE_* values.`;
  console.error(msg);
  // Throw so the developer sees this immediately — no silent mock fallback
  throw new Error(msg);
}

// ─── Firebase App Config ────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// ─── Single App Initialization ──────────────────────────────────────────────
// Guard against hot-reload double-init in development

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// ─── Service Instances ──────────────────────────────────────────────────────

const auth = getAuth(app);
const db   = getFirestore(app, 'default');
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

// Request user email scope for Google Sign-In
googleProvider.addScope('email');
googleProvider.addScope('profile');

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  app,
  auth,
  db,
  storage,
  googleProvider,

  // Auth helpers re-exported for convenience
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
};

export type { FirebaseUser };
