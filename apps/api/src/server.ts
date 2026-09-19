import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  PROVIDERS,
  RULE_TYPES,
  encryptCredentials,
  type ConnectedAccountRecord,
  type Repository,
} from "@inboxrulz/db";
import type { MailConnector } from "@inboxrulz/mail-connector";
import { parseRuleConfig, type RescueClassifier } from "@inboxrulz/rules-engine";
import { runAccountNow } from "@inboxrulz/worker";
import { auditLog, type Logger } from "@inboxrulz/logger";
import { authenticate, type IdTokenVerifier } from "./auth.js";
import { serializeAccount } from "./serializers.js";
import type { GoogleOAuth } from "./googleOAuth.js";
import { createOAuthState, consumeOAuthState } from "./oauthState.js";

export interface ApiDeps {
  repository: Repository;
  classifier: RescueClassifier;
  connectorFor: (account: ConnectedAccountRecord) => MailConnector;
  verifyIdToken: IdTokenVerifier;
  logger: Logger;
  credentialsEncryptionKey?: string;
  /** Undefined when GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI aren't
   * configured — /auth/google/* 501s rather than the app failing to boot,
   * since Gmail OAuth is optional (the manual paste-credentials path on
   * POST /accounts still works without it). */
  googleOAuth?: GoogleOAuth;
  /** Where /auth/google/callback redirects back to after connecting (or
   * failing to connect) an account. */
  webAppUrl?: string;
}

const connectAccountBody = z.object({
  provider: z.enum(PROVIDERS),
  displayName: z.string().min(1),
  // Provider-specific: an OAuth token set for gmail/outlook, an
  // app-password + host/port for imap, etc. Opaque to the API layer —
  // it's sealed as-is and only ever unpacked by the matching connector
  // factory (spec section 9: never logged or inspected in plaintext here).
  credentials: z.record(z.unknown()),
});

const upsertRuleBody = z.object({
  enabled: z.boolean(),
  order: z.number().int().min(0).default(0),
  config: z.record(z.unknown()).default({}),
});

/** Loads a connected account and 404s (never 403 — don't confirm the id
 * exists to someone who doesn't own it) unless it belongs to `userId`. A
 * mismatch is also written to the audit log — a signal worth having if it
 * ever happens more than once for the same actor. */
async function loadOwnedAccount(
  repository: Repository,
  logger: Logger,
  userId: string,
  accountId: string,
): Promise<ConnectedAccountRecord | null> {
  const account = await repository.getConnectedAccount(accountId);
  if (!account || account.userId !== userId) {
    auditLog(logger, {
      action: "access.denied",
      actorUserId: userId,
      resourceType: "connected_account",
      resourceId: accountId,
      outcome: "denied",
    });
    return null;
  }
  return account;
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  // Cast at the type level only: Fastify's generics fix the request logger
  // type to FastifyBaseLogger, which our pino instance already satisfies
  // structurally (info/warn/error/child/...) — the object handed to
  // Fastify at runtime is still the real, redacting pino logger.
  const app = Fastify({ loggerInstance: deps.logger as FastifyBaseLogger });
  void app.register(cors, { origin: true });
  const { repository, logger } = deps;

  app.get("/health", async () => ({ ok: true }));

  app.get("/accounts", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const accounts = await repository.listConnectedAccountsForUser(user.uid);
    return accounts.map(serializeAccount);
  });

  app.post("/accounts", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const parsed = connectAccountBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const encryptedCredentials = encryptCredentials(
      JSON.stringify(parsed.data.credentials),
      deps.credentialsEncryptionKey,
    );
    const account = await repository.createConnectedAccount({
      userId: user.uid,
      provider: parsed.data.provider,
      displayName: parsed.data.displayName,
      encryptedCredentials,
    });
    auditLog(logger, {
      action: "account.connected",
      actorUserId: user.uid,
      resourceType: "connected_account",
      resourceId: account.id,
      outcome: "success",
      meta: { provider: account.provider },
    });
    return reply.code(201).send(serializeAccount(account));
  });

  app.get("/accounts/:id/rules", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const { id } = request.params as { id: string };
    const account = await loadOwnedAccount(repository, logger, user.uid, id);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    return repository.listRulesForAccount(id);
  });

  app.put("/accounts/:id/rules/:type", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const { id, type } = request.params as { id: string; type: string };
    const account = await loadOwnedAccount(repository, logger, user.uid, id);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    if (!RULE_TYPES.includes(type as (typeof RULE_TYPES)[number])) {
      return reply.code(404).send({ error: `Unknown rule type "${type}"` });
    }
    const ruleType = type as (typeof RULE_TYPES)[number];

    const parsedBody = upsertRuleBody.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: parsedBody.error.flatten() });
    }

    let config: Record<string, unknown>;
    try {
      config = parseRuleConfig(ruleType, parsedBody.data.config);
    } catch (err) {
      return reply.code(400).send({ error: `Invalid config for ${ruleType}: ${String(err)}` });
    }

    const rule = await repository.upsertRule({
      connectedAccountId: id,
      type: ruleType,
      enabled: parsedBody.data.enabled,
      order: parsedBody.data.order,
      config,
    });
    auditLog(logger, {
      action: "rule.updated",
      actorUserId: user.uid,
      resourceType: "rule",
      resourceId: rule.id,
      outcome: "success",
      meta: { connectedAccountId: id, ruleType, enabled: rule.enabled },
    });
    return rule;
  });

  app.post("/accounts/:id/run", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const { id } = request.params as { id: string };
    const account = await loadOwnedAccount(repository, logger, user.uid, id);
    if (!account) return reply.code(404).send({ error: "Account not found" });

    try {
      await runAccountNow(id, {
        repository: deps.repository,
        classifier: deps.classifier,
        connectorFor: deps.connectorFor,
        logger: deps.logger,
      });
    } catch (err) {
      auditLog(logger, {
        action: "run.triggered",
        actorUserId: user.uid,
        resourceType: "run",
        resourceId: id,
        outcome: "failure",
        meta: { reason: String(err) },
      });
      return reply.code(502).send({ error: `Run failed to start: ${String(err)}` });
    }

    auditLog(logger, {
      action: "run.triggered",
      actorUserId: user.uid,
      resourceType: "run",
      resourceId: id,
      outcome: "success",
    });

    const [latestRun] = await repository.listRuns(id, 1);
    const actions = latestRun ? await repository.listActionsForRun(latestRun.id) : [];
    return reply.code(202).send({ run: latestRun, actions });
  });

  app.get("/accounts/:id/runs", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const { id } = request.params as { id: string };
    const account = await loadOwnedAccount(repository, logger, user.uid, id);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    const { limit } = request.query as { limit?: string };
    return repository.listRuns(id, limit ? Number(limit) : undefined);
  });

  app.get("/accounts/:id/runs/:runId/actions", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    const { id, runId } = request.params as { id: string; runId: string };
    const account = await loadOwnedAccount(repository, logger, user.uid, id);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    return repository.listActionsForRun(runId);
  });

  const webAppUrl = deps.webAppUrl ?? "http://localhost:3000";

  app.get("/auth/google/start", async (request, reply) => {
    const user = await authenticate(request, reply, deps.verifyIdToken, logger);
    if (!user) return;
    if (!deps.googleOAuth) {
      return reply.code(501).send({ error: "Google OAuth is not configured on this server" });
    }
    const state = createOAuthState(user.uid);
    return { url: deps.googleOAuth.buildAuthUrl(state) };
  });

  // Google redirects the browser here directly — no Authorization header
  // is possible on this request, which is exactly what the state token
  // (bound to a uid at /auth/google/start) stands in for.
  app.get("/auth/google/callback", async (request, reply) => {
    if (!deps.googleOAuth) {
      return reply.code(501).send({ error: "Google OAuth is not configured on this server" });
    }
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    if (error) {
      return reply.redirect(`${webAppUrl}/?oauthError=${encodeURIComponent(error)}`);
    }
    const uid = state ? consumeOAuthState(state) : null;
    if (!uid || !code) {
      return reply.redirect(`${webAppUrl}/?oauthError=invalid_state`);
    }

    try {
      const tokenSet = await deps.googleOAuth.exchangeCode(code);
      const encryptedCredentials = encryptCredentials(
        JSON.stringify({
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          clientId: tokenSet.clientId,
          clientSecret: tokenSet.clientSecret,
          expiryDate: tokenSet.expiryDate,
        }),
        deps.credentialsEncryptionKey,
      );
      const account = await repository.createConnectedAccount({
        userId: uid,
        provider: "gmail",
        displayName: tokenSet.email ?? "Gmail",
        encryptedCredentials,
      });
      auditLog(logger, {
        action: "account.connected",
        actorUserId: uid,
        resourceType: "connected_account",
        resourceId: account.id,
        outcome: "success",
        meta: { provider: "gmail", via: "oauth" },
      });
      return reply.redirect(`${webAppUrl}/accounts/${account.id}`);
    } catch (err) {
      logger.error({ err }, "google oauth callback failed");
      return reply.redirect(`${webAppUrl}/?oauthError=exchange_failed`);
    }
  });

  return app;
}
