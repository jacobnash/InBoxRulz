import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "@inboxrulz/logger";
import { auditLog } from "@inboxrulz/logger";

export interface AuthenticatedUser {
  uid: string;
  email?: string;
}

/** Verifies a raw Firebase ID token and returns the principal it belongs
 * to, or throws. Injected so routes and tests never depend on a live
 * Firebase project — see firebaseAuth.ts for the real implementation and
 * test/server.test.ts for a fake one. */
export type IdTokenVerifier = (idToken: string) => Promise<AuthenticatedUser>;

const BEARER_PREFIX = "Bearer ";

/**
 * Replaces the old `x-user-id` placeholder (see git history) with real
 * authentication: the dashboard signs the user in via Firebase Auth
 * (Google SSO) and sends the resulting ID token as a bearer token on every
 * request. This verifies it and 401s otherwise — every failure is also
 * written to the audit log, since a spike of these is exactly the signal
 * an intrusion-detection process would want (spec section 9 / the
 * SOC2-readiness gap: no audit trail was the real production hole).
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  verifyIdToken: IdTokenVerifier,
  logger: Logger,
): Promise<AuthenticatedUser | undefined> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    auditLog(logger, {
      action: "auth.failed",
      outcome: "denied",
      meta: { reason: "missing or malformed Authorization header", path: request.url },
    });
    reply.code(401).send({ error: "Missing or malformed Authorization header" });
    return undefined;
  }

  const idToken = header.slice(BEARER_PREFIX.length);
  try {
    return await verifyIdToken(idToken);
  } catch (err) {
    auditLog(logger, {
      action: "auth.failed",
      outcome: "failure",
      meta: { reason: String(err), path: request.url },
    });
    reply.code(401).send({ error: "Invalid or expired token" });
    return undefined;
  }
}
