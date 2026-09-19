import { describe, expect, it, beforeEach } from "vitest";
import { Writable } from "node:stream";
import { InMemoryRepository } from "@inboxrulz/db";
import { MockConnector } from "@inboxrulz/mail-connector";
import type { RescueClassifier } from "@inboxrulz/rules-engine";
import { createLogger } from "@inboxrulz/logger";
import { buildServer } from "../src/server.js";
import type { IdTokenVerifier } from "../src/auth.js";
import type { GoogleOAuth } from "../src/googleOAuth.js";
import type { FastifyInstance } from "fastify";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64");
const classifier: RescueClassifier = () => ({ important: false, reason: "n/a" });

/** Treats the bearer token itself as the uid, except for the sentinel
 * "bad-token", which simulates an expired/invalid token. Keeps tests
 * independent of any real Firebase project. */
const fakeVerifyIdToken: IdTokenVerifier = async (token) => {
  if (token === "bad-token") throw new Error("token expired");
  return { uid: token, email: `${token}@example.com` };
};

function authHeader(uid: string) {
  return { authorization: `Bearer ${uid}` };
}

function captureAuditLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger("test-api", { stream });
  const auditEntries = () => lines.map((l) => JSON.parse(l)).filter((e) => e.audit === true);
  return { logger, auditEntries };
}

const fakeGoogleOAuth: GoogleOAuth = {
  buildAuthUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  exchangeCode: async (code) => {
    if (code === "bad-code") throw new Error("invalid_grant");
    return {
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      email: "connected@example.com",
    };
  },
};

function makeApp(repository = new InMemoryRepository(), googleOAuth: GoogleOAuth | undefined = fakeGoogleOAuth) {
  const { logger, auditEntries } = captureAuditLogs();
  return {
    repository,
    auditEntries,
    app: buildServer({
      repository,
      classifier,
      connectorFor: () => new MockConnector({ messages: [] }),
      verifyIdToken: fakeVerifyIdToken,
      logger,
      credentialsEncryptionKey: TEST_KEY,
      googleOAuth,
      webAppUrl: "http://localhost:3000",
    }),
  };
}

describe("API server", () => {
  let app: FastifyInstance;
  let repository: InMemoryRepository;
  let auditEntries: () => Record<string, unknown>[];

  beforeEach(() => {
    ({ app, repository, auditEntries } = makeApp());
  });

  it("requires a bearer token on protected routes", async () => {
    const res = await app.inject({ method: "GET", url: "/accounts" });
    expect(res.statusCode).toBe(401);
    expect(auditEntries()).toContainEqual(expect.objectContaining({ action: "auth.failed" }));
  });

  it("401s and audits an invalid/expired token", async () => {
    const res = await app.inject({ method: "GET", url: "/accounts", headers: authHeader("bad-token") });
    expect(res.statusCode).toBe(401);
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "auth.failed", outcome: "failure" }),
    );
  });

  it("health check needs no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("connects an account without leaking credentials back, and audits it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader("user-1"),
      payload: {
        provider: "gmail",
        displayName: "me@gmail.com",
        credentials: { accessToken: "secret-token" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.displayName).toBe("me@gmail.com");
    expect(body).not.toHaveProperty("encryptedCredentials");
    expect(JSON.stringify(body)).not.toContain("secret-token");

    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "account.connected", actorUserId: "user-1", outcome: "success" }),
    );
  });

  it("rejects an invalid connect-account body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader("user-1"),
      payload: { provider: "carrier-pigeon", displayName: "x", credentials: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("only lists accounts belonging to the requesting user", async () => {
    await repository.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "mine",
      encryptedCredentials: "x",
    });
    await repository.createConnectedAccount({
      userId: "user-2",
      provider: "gmail",
      displayName: "not-mine",
      encryptedCredentials: "x",
    });

    const res = await app.inject({ method: "GET", url: "/accounts", headers: authHeader("user-1") });
    const accounts = res.json();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].displayName).toBe("mine");
  });

  it("404s for an account belonging to someone else, not 403, and audits it as denied", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-2",
      provider: "gmail",
      displayName: "not-mine",
      encryptedCredentials: "x",
    });
    const res = await app.inject({
      method: "GET",
      url: `/accounts/${account.id}/rules`,
      headers: authHeader("user-1"),
    });
    expect(res.statusCode).toBe(404);
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "access.denied", actorUserId: "user-1", resourceId: account.id }),
    );
  });

  it("upserts a rule, validates its config, and audits the change", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "mine",
      encryptedCredentials: "x",
    });

    const good = await app.inject({
      method: "PUT",
      url: `/accounts/${account.id}/rules/retention_purge`,
      headers: authHeader("user-1"),
      payload: { enabled: true, config: { retentionDays: 45 } },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().config.retentionDays).toBe(45);
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "rule.updated", actorUserId: "user-1" }),
    );

    const bad = await app.inject({
      method: "PUT",
      url: `/accounts/${account.id}/rules/retention_purge`,
      headers: authHeader("user-1"),
      payload: { enabled: true, config: { retentionDays: -5 } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("404s for an unknown rule type", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "mine",
      encryptedCredentials: "x",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/accounts/${account.id}/rules/not_a_real_rule`,
      headers: authHeader("user-1"),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it("triggers a manual run, returns the run + its actions, and audits the trigger", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "mine",
      encryptedCredentials: "x",
    });
    await repository.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: true,
      order: 0,
      config: {},
    });

    const res = await app.inject({
      method: "POST",
      url: `/accounts/${account.id}/run`,
      headers: authHeader("user-1"),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.run.trigger).toBe("manual");
    expect(body.run.status).toBe("succeeded");
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "run.triggered", actorUserId: "user-1", outcome: "success" }),
    );

    const runsRes = await app.inject({
      method: "GET",
      url: `/accounts/${account.id}/runs`,
      headers: authHeader("user-1"),
    });
    expect(runsRes.json()).toHaveLength(1);
  });

  describe("Google OAuth connect flow", () => {
    it("501s both routes when Google OAuth isn't configured", async () => {
      const { logger } = captureAuditLogs();
      app = buildServer({
        repository: new InMemoryRepository(),
        classifier,
        connectorFor: () => new MockConnector({ messages: [] }),
        verifyIdToken: fakeVerifyIdToken,
        logger,
        credentialsEncryptionKey: TEST_KEY,
        // googleOAuth intentionally omitted
      });
      const start = await app.inject({
        method: "GET",
        url: "/auth/google/start",
        headers: authHeader("user-1"),
      });
      expect(start.statusCode).toBe(501);

      const callback = await app.inject({ method: "GET", url: "/auth/google/callback?code=x&state=y" });
      expect(callback.statusCode).toBe(501);
    });

    it("requires auth to start, and returns Google's consent URL", async () => {
      const unauthed = await app.inject({ method: "GET", url: "/auth/google/start" });
      expect(unauthed.statusCode).toBe(401);

      const res = await app.inject({ method: "GET", url: "/auth/google/start", headers: authHeader("user-1") });
      expect(res.statusCode).toBe(200);
      expect(res.json().url).toContain("accounts.google.com");
    });

    it("completes the flow: exchanges the code, creates the account under the uid that started it, and redirects there", async () => {
      const start = await app.inject({ method: "GET", url: "/auth/google/start", headers: authHeader("user-1") });
      const state = new URL(start.json().url).searchParams.get("state")!;

      const callback = await app.inject({
        method: "GET",
        url: `/auth/google/callback?code=good-code&state=${state}`,
      });
      expect(callback.statusCode).toBe(302);

      const accounts = await repository.listConnectedAccountsForUser("user-1");
      expect(accounts).toHaveLength(1);
      expect(accounts[0].provider).toBe("gmail");
      expect(accounts[0].displayName).toBe("connected@example.com");
      expect(callback.headers.location).toBe(`http://localhost:3000/accounts/${accounts[0].id}`);
      expect(auditEntries()).toContainEqual(
        expect.objectContaining({ action: "account.connected", actorUserId: "user-1" }),
      );
    });

    it("rejects a forged/expired state instead of creating an account", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/google/callback?code=good-code&state=not-a-real-state",
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:3000/?oauthError=invalid_state");
      expect(await repository.listConnectedAccountsForUser("user-1")).toHaveLength(0);
    });

    it("redirects with an error (and creates no account) when the token exchange fails", async () => {
      const start = await app.inject({ method: "GET", url: "/auth/google/start", headers: authHeader("user-1") });
      const state = new URL(start.json().url).searchParams.get("state")!;

      const res = await app.inject({
        method: "GET",
        url: `/auth/google/callback?code=bad-code&state=${state}`,
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:3000/?oauthError=exchange_failed");
      expect(await repository.listConnectedAccountsForUser("user-1")).toHaveLength(0);
    });
  });
});
