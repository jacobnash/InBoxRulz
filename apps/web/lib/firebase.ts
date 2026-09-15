import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";

/**
 * Public Firebase Web SDK config — these values are meant to be shipped to
 * the browser (they identify the project, not authorize anything on their
 * own; Firebase's security rules and, here, the API's server-side ID
 * token verification are what actually gate access). Get them from the
 * Firebase console: Project settings -> General -> Your apps -> Web app.
 */
function firebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error(
      "Firebase client config is incomplete. Set NEXT_PUBLIC_FIREBASE_API_KEY, " +
        "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and " +
        "NEXT_PUBLIC_FIREBASE_APP_ID (see .env.example).",
    );
  }
  return { apiKey, authDomain, projectId, appId };
}

let app: FirebaseApp | undefined;

function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig());
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/** Google is the only SSO provider wired up today; Firebase makes adding
 * Microsoft/SAML/OIDC providers later a config change in the Firebase
 * console plus one more button here, not a backend change — the API only
 * ever sees a verified ID token, never which provider issued it. */
export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export function subscribeToAuthChanges(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export type { User };
