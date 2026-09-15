import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./inMemoryRepository.js";
import type { ConnectedAccountRecord } from "./models.js";

function makeAccount(overrides: Partial<ConnectedAccountRecord> = {}): ConnectedAccountRecord {
  return {
    id: "acct-1",
    userId: "user-1",
    provider: "gmail",
    displayName: "me@gmail.com",
    encryptedCredentials: "sealed",
    status: "active",
    connectedAt: new Date(),
    ...overrides,
  };
}

describe("InMemoryRepository", () => {
  it("only lists active accounts", async () => {
    const repo = new InMemoryRepository();
    repo.seedAccount(makeAccount({ id: "a", status: "active" }));
    repo.seedAccount(makeAccount({ id: "b", status: "disabled" }));
    const active = await repo.listActiveConnectedAccounts();
    expect(active.map((a) => a.id)).toEqual(["a"]);
  });

  it("creates a connected account and lists it back for its user", async () => {
    const repo = new InMemoryRepository();
    const created = await repo.createConnectedAccount({
      userId: "user-1",
      provider: "gmail",
      displayName: "me@gmail.com",
      encryptedCredentials: "sealed",
    });
    expect(created.status).toBe("active");

    const forUser = await repo.listConnectedAccountsForUser("user-1");
    expect(forUser.map((a) => a.id)).toEqual([created.id]);
    expect(await repo.listConnectedAccountsForUser("someone-else")).toEqual([]);
  });

  it("upsertRule updates in place on a repeat call for the same type", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    repo.seedAccount(account);
    const first = await repo.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: true,
      order: 0,
      config: {},
    });
    const second = await repo.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: false,
      order: 0,
      config: {},
    });
    expect(second.id).toBe(first.id);
    const rules = await repo.listRulesForAccount(account.id);
    expect(rules).toHaveLength(1);
    expect(rules[0].enabled).toBe(false);
  });

  it("tracks a run lifecycle and its actions", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    repo.seedAccount(account);
    const rule = await repo.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: true,
      order: 0,
      config: {},
    });

    const run = await repo.createRun(account.id, "manual");
    expect(run.status).toBe("running");

    await repo.recordAction({
      runId: run.id,
      ruleId: rule.id,
      threadId: "thread-1",
      action: "archive",
      reason: "test",
    });
    const finished = await repo.finishRun(run.id, "succeeded");
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).not.toBeNull();

    const actions = await repo.listActionsForRun(run.id);
    expect(actions).toHaveLength(1);
    expect(actions[0].threadId).toBe("thread-1");

    const runs = await repo.listRuns(account.id);
    expect(runs).toHaveLength(1);
  });
});
