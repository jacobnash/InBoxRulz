import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { IdTokenVerifier } from "./auth.js";

let app: App | undefined;

function getFirebaseApp(projectId: string): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp({ projectId });
  }
  return app;
}

/**
 * Real Firebase ID token verification, backing `IdTokenVerifier`.
 *
 * Needs only a project id — not a secret, just the public Firebase project
 * identifier the dashboard's client config also carries. Verifying a
 * token means checking its signature against Google's own public keys
 * (fetched automatically over HTTPS, no credential required for that) and
 * confirming the `aud`/`iss` claims name this project. No service-account
 * key or other secret is needed for this path, which matters for a
 * VPS/self-managed deployment with no cloud secrets manager to hold one.
 */
export function createFirebaseIdTokenVerifier(projectId: string): IdTokenVerifier {
  return async (idToken) => {
    const decoded = await getAuth(getFirebaseApp(projectId)).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  };
}
