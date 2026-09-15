import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Placeholder auth: the caller identifies themselves via `x-user-id`.
 *
 * A real deployment needs session/JWT-based login plus the OAuth consent
 * flows for Gmail/Outlook described in spec section 9 — both require
 * provider app registration this sandbox can't do. This header is a
 * stand-in so every other route can be built and tested against a real
 * authorization boundary (an account only ever belongs to one user, and
 * every route below enforces that) without waiting on that integration.
 */
export function requireUserId(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const userId = request.headers["x-user-id"];
  if (typeof userId !== "string" || userId.length === 0) {
    reply.code(401).send({ error: "Missing x-user-id header" });
    return undefined;
  }
  return userId;
}
