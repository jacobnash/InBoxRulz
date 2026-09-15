import { describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { InMemoryRepository, type ConnectedAccountRecord } from "@inboxrulz/db";
import { MockConnector } from "@inboxrulz/mail-connector";
import type { RescueClassifier } from "@inboxrulz/rules-engine";
import { createLogger } from "@inboxrulz/logger";
import { runAllActiveAccounts, runAccountNow } from "../src/scheduler.js";

const logger = createLogger("test-worker", { stream: new Writable({ write: (_c, _e, cb) => cb() }) });

function makeAccount(overrides: Partial<ConnectedAccountRecord> = {}): ConnectedAccountRecord {
  return {
    id: "acct-1",
    userId: "user-1",
    provider: "gmail",
    displayName: "me@gmail.com",
    encryptedCredentials: "n/a",
    status: "active",
    connectedAt: new Date(),
    ...overrides,
  };
}

const classifier: RescueClassifier = () => ({ important: false, reason: "n/a" });

describe("runAllActiveAccounts", () => {
  it("runs every active account and isolates one account's failure from the rest", async () => {
    const repo = new InMemoryRepository();
    repo.seedAccount(makeAccount({ id: "good" }));
    repo.seedAccount(makeAccount({ id: "bad" }));
    repo.seedAccount(makeAccount({ id: "inactive", status: "disabled" }));

    const connectorFor = vi.fn((account: ConnectedAccountRecord) => {
      if (account.id === "bad") {
        throw new Error("no credentials");
      }
      return new MockConnector({ messages: [] });
    });

    await runAllActiveAccounts({ repository: repo, classifier, connectorFor, logger });

    expect(connectorFor).toHaveBeenCalledTimes(2); // good + bad, never the disabled one
    const goodRuns = await repo.listRuns("good");
    expect(goodRuns).toHaveLength(1);
    expect(goodRuns[0].status).toBe("succeeded");
  });
});

describe("runAccountNow", () => {
  it("triggers a manual run for one account", async () => {
    const repo = new InMemoryRepository();
    repo.seedAccount(makeAccount());
    const connectorFor = () => new MockConnector({ messages: [] });

    await runAccountNow("acct-1", { repository: repo, classifier, connectorFor, logger });

    const runs = await repo.listRuns("acct-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("manual");
  });

  it("throws for an unknown account", async () => {
    const repo = new InMemoryRepository();
    const connectorFor = () => new MockConnector({ messages: [] });
    await expect(runAccountNow("missing", { repository: repo, classifier, connectorFor, logger })).rejects.toThrow(
      /Unknown connected account/,
    );
  });
});
