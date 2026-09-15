import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryRepository } from "@inboxrulz/db";
import { MockConnector } from "@inboxrulz/mail-connector";
import type { RescueClassifier } from "@inboxrulz/rules-engine";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64");
const classifier: RescueClassifier = () => ({ important: false, reason: "n/a" });

function makeApp(repository = new InMemoryRepository()) {
  return {
    repository,
    app: buildServer({
      repository,
      classifier,
      connectorFor: () => new MockConnector({ messages: [] }),
      credentialsEncryptionKey: TEST_KEY,
    }),
  };
}

describe("API server", () => {
  let app: FastifyInstance;
  let repository: InMemoryRepository;

  beforeEach(() => {
    ({ app, repository } = makeApp());
  });

  it("requires x-user-id on protected routes", async () => {
    const res = await app.inject({ method: "GET", url: "/accounts" });
    expect(res.statusCode).toBe(401);
  });

  it("health check needs no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("connects an account without leaking credentials back", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { "x-user-id": "user-1" },
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
  });

  it("rejects an invalid connect-account body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { "x-user-id": "user-1" },
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

    const res = await app.inject({ method: "GET", url: "/accounts", headers: { "x-user-id": "user-1" } });
    const accounts = res.json();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].displayName).toBe("mine");
  });

  it("404s for an account belonging to someone else, not 403", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-2",
      provider: "gmail",
      displayName: "not-mine",
      encryptedCredentials: "x",
    });
    const res = await app.inject({
      method: "GET",
      url: `/accounts/${account.id}/rules`,
      headers: { "x-user-id": "user-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("upserts a rule and validates its config", async () => {
    const account = await repository.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "mine",
      encryptedCredentials: "x",
    });

    const good = await app.inject({
      method: "PUT",
      url: `/accounts/${account.id}/rules/retention_purge`,
      headers: { "x-user-id": "user-1" },
      payload: { enabled: true, config: { retentionDays: 45 } },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().config.retentionDays).toBe(45);

    const bad = await app.inject({
      method: "PUT",
      url: `/accounts/${account.id}/rules/retention_purge`,
      headers: { "x-user-id": "user-1" },
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
      headers: { "x-user-id": "user-1" },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it("triggers a manual run and returns the run + its actions", async () => {
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
      headers: { "x-user-id": "user-1" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.run.trigger).toBe("manual");
    expect(body.run.status).toBe("succeeded");

    const runsRes = await app.inject({
      method: "GET",
      url: `/accounts/${account.id}/runs`,
      headers: { "x-user-id": "user-1" },
    });
    expect(runsRes.json()).toHaveLength(1);
  });
});
