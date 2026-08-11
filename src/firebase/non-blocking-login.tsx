'use client';
import {
  Auth,
  GoogleAuthProvider,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';

/** Sign in anonymously and let the auth-state listener update the app shell. */
export function initiateAnonymousSignIn(authInstance: Auth) {
  return signInAnonymously(authInstance);
}

/** Sign up with email and password. */
export function initiateEmailSignUp(authInstance: Auth, email: string, password: string) {
  return createUserWithEmailAndPassword(authInstance, email, password);
}

/** Sign in with email and password. */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string) {
  return signInWithEmailAndPassword(authInstance, email, password);
}

function buildGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

/** Sign in with Google OAuth, falling back to a full-page redirect if the popup cannot render. */
export async function initiateGoogleSignIn(authInstance: Auth) {
  try {
    return await signInWithPopup(authInstance, buildGoogleProvider());
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(authInstance, buildGoogleProvider());
      return null;
    }

    throw error;
  }
}
