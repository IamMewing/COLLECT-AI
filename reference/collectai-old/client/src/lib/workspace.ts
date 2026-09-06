// ============================================
// CollectAI — Workspace Firestore Service
// Single source of truth for workspace operations.
// ============================================

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceData {
  uid: string;
  displayName: string;
  studioName: string;
  profession: string;
  businessSize: string;
  country: string;
  timezone: string;
  currency: string;
  language: string;
  phone: string;
  reminderTone: 'polite' | 'neutral' | 'firm';
  invoicePrefix: string;
  ownerEmail: string;
  recoveryGoal: string;
  preferredContactMethod: string;
  createdAt: Timestamp | null;
}

export interface WorkspaceCheckResult {
  exists: boolean;
  tourCompleted: boolean;
  workspace: WorkspaceData | null;
}

// ─── Check if workspace exists ────────────────────────────────────────────────

export async function checkWorkspaceExists(uid: string): Promise<WorkspaceCheckResult> {
  try {
    const [workspaceSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'workspaces', uid)),
      getDoc(doc(db, 'users', uid)),
    ]);

    const exists = workspaceSnap.exists();
    const tourCompleted = userSnap.exists() ? (userSnap.data()?.tourCompleted === true) : false;
    const workspace = exists ? (workspaceSnap.data() as WorkspaceData) : null;

    return { exists, tourCompleted, workspace };
  } catch (err: any) {
    // Re-throw with a consistent message so callers can distinguish not-found from network errors
    const code = err?.code || '';
    const msg  = err?.message || '';
    if (code === 'not-found' || msg.includes('NOT_FOUND') || msg.includes('not found') || msg.includes('Database')) {
      throw new Error('NOT_FOUND: Firestore database not initialised yet');
    }
    throw err;
  }
}


// ─── Create full workspace + all sub-documents ───────────────────────────────

export async function createWorkspace(uid: string, data: Omit<WorkspaceData, 'uid' | 'createdAt'>): Promise<void> {
  const now = serverTimestamp();

  // Run all writes in parallel for speed
  await Promise.all([
    // /workspaces/{uid}
    setDoc(doc(db, 'workspaces', uid), {
      uid,
      ...data,
      createdAt: now,
    }),

    // /workspaceSettings/{uid}
    setDoc(doc(db, 'workspaceSettings', uid), {
      uid,
      autoRun: true,
      checkInterval: '24h',
      notifyOnResolve: true,
      theme: 'light',
      updatedAt: now,
    }),

    // /agentMemory/{uid}
    setDoc(doc(db, 'agentMemory', uid), {
      uid,
      initialized: true,
      clientProfiles: {},
      paymentPatterns: {},
      lastSweep: null,
      createdAt: now,
    }),

    // /preferences/{uid}
    setDoc(doc(db, 'preferences', uid), {
      uid,
      currency: data.currency,
      language: data.language,
      timezone: data.timezone,
      updatedAt: now,
    }),

    // Update /users/{uid} with workspace link and onboarding flag
    setDoc(doc(db, 'users', uid), {
      onboardingCompleted: true,
      workspaceId: uid,
      profile: { ...data },
      updatedAt: now,
    }, { merge: true }),
  ]);

  // Verification read check: Ensure workspace document exists
  const verifySnap = await getDoc(doc(db, 'workspaces', uid));
  if (!verifySnap.exists()) {
    throw new Error('Workspace document verification failed after creation.');
  }
}

// ─── Mark tour as complete ────────────────────────────────────────────────────

export async function markTourComplete(uid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid), {
    tourCompleted: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ─── Get workspace data ───────────────────────────────────────────────────────

export async function getWorkspace(uid: string): Promise<WorkspaceData | null> {
  const snap = await getDoc(doc(db, 'workspaces', uid));
  return snap.exists() ? (snap.data() as WorkspaceData) : null;
}
