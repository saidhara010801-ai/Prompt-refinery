'use client';
import {
  Auth,
  GoogleAuthProvider,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
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

/** Sign in with Google OAuth in a popup. */
export function initiateGoogleSignIn(authInstance: Auth) {
  return signInWithPopup(authInstance, new GoogleAuthProvider());
}
