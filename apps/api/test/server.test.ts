import { describe, expect, it, beforeEach } from "vitest";
import { Writable } from "node:stream";
import { InMemoryRepository } from "@inboxrulz/db";
import { MockConnector } from "@inboxrulz/mail-connector";
import type { RescueClassifier } from "@inboxrulz/rules-engine";
import { createLogger } from "@inboxrulz/logger";
import { buildServer } from "../src/server.js";
import type { IdTokenVerifier } from "../src/auth.js";
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

function makeApp(repository = new InMemoryRepository()) {
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
});
