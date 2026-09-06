// ============================================
// CollectAI — Authentication Context (Production)
// Real Firebase Auth only. No mocks. No sandbox. No localStorage sessions.
// ============================================

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  googleProvider,
  db,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  type FirebaseUser,
} from '../firebase/config';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (displayName: string) => Promise<void>;
  updateUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Map Firebase User → App User ─────────────────────────────────────────

function mapFirebaseUser(fbUser: FirebaseUser): User {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName,
    photoURL: fbUser.photoURL,
    phoneNumber: fbUser.phoneNumber,
  };
}

// ─── Provision Firestore User Document ───────────────────────────────────────
// Creates a /users/{uid} document on first sign-in

async function provisionUserDocument(fbUser: FirebaseUser): Promise<void> {
  try {
    const ref = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
        photoURL: fbUser.photoURL || null,
        onboardingCompleted: false,
        workspaceInitialized: false,
        tourCompleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        workspaceId: '',
        profile: null,
        plan: 'free',
      });
    }
  } catch (err) {
    // Non-fatal — user can still use the app even if provisioning fails
    console.warn('[AuthContext] Failed to provision user document:', err);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Real Firebase auth state listener — the only source of truth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        // Set user state and clear loading IMMEDIATELY — don't wait on Firestore
        setUser(mapFirebaseUser(fbUser));
        setLoading(false);
        // Provision Firestore user doc in background (non-blocking)
        provisionUserDocument(fbUser).catch((err) =>
          console.warn('[AuthContext] Background provisioning failed:', err)
        );
      } else {
        setUser(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const loginWithGoogle = async (): Promise<void> => {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged handles setting user state
  };

  const loginWithEmail = async (email: string, pass: string): Promise<void> => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const signupWithEmail = async (email: string, pass: string): Promise<void> => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    // Set a display name from the email prefix on new signup
    if (!cred.user.displayName) {
      await updateProfile(cred.user, {
        displayName: email.split('@')[0],
      });
    }
  };

  const logout = async (): Promise<void> => {
    sessionStorage.removeItem('onboardingCompleted');
    sessionStorage.removeItem('workspaceInitialized');
    sessionStorage.removeItem('tourCompleted');
    await signOut(auth);
    // onAuthStateChanged sets user → null
  };

  const resetPassword = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(auth, email);
  };

  const updateUserProfile = async (displayName: string): Promise<void> => {
    if (!auth.currentUser) throw new Error('No authenticated user');
    await updateProfile(auth.currentUser, { displayName });
    setUser((prev) => (prev ? { ...prev, displayName } : null));
    // Also update Firestore user document
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid), { displayName }, { merge: true });
    } catch { /* non-fatal */ }
  };

  const updateUserPassword = async (_currentPassword: string, newPassword: string): Promise<void> => {
    if (!auth.currentUser) throw new Error('No authenticated user');
    await updatePassword(auth.currentUser, newPassword);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      loginWithGoogle,
      loginWithEmail,
      signupWithEmail,
      logout,
      resetPassword,
      updateUserProfile,
      updateUserPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};
