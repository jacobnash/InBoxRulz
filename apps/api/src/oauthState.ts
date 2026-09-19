import { randomUUID } from "node:crypto";

/**
 * Binds a short-lived, single-use state token to the uid that started the
 * OAuth flow. Google's redirect back to /auth/google/callback can't carry
 * our own bearer token, so this is what stops the callback from being
 * forgeable into attaching a connected account to the wrong user.
 *
 * ponytail: in-memory, single-process — fine since apps/api runs as one
 * container (docker-compose.yml isn't horizontally scaled); move this into
 * the shared Postgres repository if that ever changes.
 */
const TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, { uid: string; expiresAt: number }>();

export function createOAuthState(uid: string): string {
  const state = randomUUID();
  pending.set(state, { uid, expiresAt: Date.now() + TTL_MS });
  return state;
}

export function consumeOAuthState(state: string): string | null {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.uid;
}
