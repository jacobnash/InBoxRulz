import { describe, expect, it } from "vitest";
import { InMemoryRepository, type ConnectedAccountRecord } from "@inboxrulz/db";
import { MockConnector } from "@inboxrulz/mail-connector";
import { TAGS, type NormalizedMessage, type RescueClassifier } from "@inboxrulz/rules-engine";
import { runOnce } from "../src/runner.js";

const now = new Date("2026-02-01T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeAccount(overrides: Partial<ConnectedAccountRecord> = {}): ConnectedAccountRecord {
  return {
    id: "acct-1",
    userId: "user-1",
    provider: "gmail",
    displayName: "me@gmail.com",
    encryptedCredentials: "n/a",
    status: "active",
    connectedAt: now,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    threadId: `t-${Math.random()}`,
    from: "sender@example.com",
    subject: "subject",
    snippet: "snippet",
    receivedAt: now,
    inInbox: true,
    tags: [],
    ...overrides,
  };
}

const neverImportant: RescueClassifier = () => ({ important: false, reason: "test default" });

async function setupAccountWithAllRules(repo: InMemoryRepository, account: ConnectedAccountRecord) {
  repo.seedAccount(account);
  const types = ["promo_archive", "receipts_file", "delivered_trash", "retention_purge", "rescue"] as const;
  await Promise.all(
    types.map((type, i) =>
      repo.upsertRule({
        connectedAccountId: account.id,
        type,
        enabled: true,
        order: i,
        config: {},
      }),
    ),
  );
}

describe("runOnce", () => {
  it("runs every enabled rule and records a run + actions for each match", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    await setupAccountWithAllRules(repo, account);

    const promo = makeMessage({ threadId: "promo", category: "promotions", inInbox: true });
    const purchase = makeMessage({ threadId: "purchase", category: "purchases", inInbox: true });
    const delivered = makeMessage({
      threadId: "delivered",
      subject: "Your order has been delivered",
      inInbox: true,
    });
    const agedOut = makeMessage({
      threadId: "aged-out",
      inInbox: false,
      tags: [TAGS.PROMO_ARCHIVED],
      receivedAt: daysAgo(31),
    });

    const connector = new MockConnector({ now, messages: [promo, purchase, delivered, agedOut] });

    await runOnce(account, connector, repo, { trigger: "manual", classifier: neverImportant, now });

    expect(connector.getState("promo")?.inInbox).toBe(false);
    expect(connector.getState("promo")?.tags).toContain(TAGS.PROMO_ARCHIVED);

    expect(connector.getState("purchase")?.inInbox).toBe(false);
    expect(connector.getState("purchase")?.tags).toContain(TAGS.RECEIPTS);

    expect(connector.getState("delivered")).toBeUndefined(); // trashed

    expect(connector.getState("aged-out")).toBeUndefined(); // trashed by retention_purge

    const [run] = await repo.listRuns(account.id);
    expect(run.status).toBe("succeeded");
    expect(run.trigger).toBe("manual");

    const actions = await repo.listActionsForRun(run.id);
    expect(actions.length).toBeGreaterThanOrEqual(5);
  });

  it("restores and permanently tags a rescued thread, and never re-rescues it", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    await setupAccountWithAllRules(repo, account);

    const important = makeMessage({
      threadId: "important",
      inInbox: false,
      receivedAt: daysAgo(1),
    });
    const connector = new MockConnector({ now, messages: [important] });
    const alwaysImportant: RescueClassifier = () => ({ important: true, reason: "looks important" });

    await runOnce(account, connector, repo, { trigger: "manual", classifier: alwaysImportant, now });
    expect(connector.getState("important")?.inInbox).toBe(true);
    expect(connector.getState("important")?.tags).toContain(TAGS.RESCUED);

    // User archives it again; a second run must not re-rescue it even
    // though the classifier would still say "important" — the permanent
    // tag makes this a one-time decision (spec section 4).
    await connector.applyAction({
      ruleType: "rescue",
      threadId: "important",
      action: "archive",
      reason: "user re-archived",
    });
    await runOnce(account, connector, repo, { trigger: "manual", classifier: alwaysImportant, now });
    expect(connector.getState("important")?.inInbox).toBe(false);
  });

  it("marks the run 'partial' when one rule fails but others succeed", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    repo.seedAccount(account);
    await repo.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: true,
      order: 0,
      config: {},
    });
    await repo.upsertRule({
      connectedAccountId: account.id,
      type: "receipts_file",
      enabled: true,
      order: 1,
      config: {},
    });

    const promo = makeMessage({ threadId: "promo", category: "promotions", inInbox: true });
    const connector = new MockConnector({ now, messages: [promo] });
    const originalListMessages = connector.listMessages.bind(connector);
    connector.listMessages = async (query) => {
      if (query.category === "purchases") throw new Error("provider outage");
      return originalListMessages(query);
    };

    await runOnce(account, connector, repo, { trigger: "manual", classifier: neverImportant, now });

    const [run] = await repo.listRuns(account.id);
    expect(run.status).toBe("partial");
    expect(connector.getState("promo")?.inInbox).toBe(false); // promo_archive still ran
  });

  it("skips disabled rules", async () => {
    const repo = new InMemoryRepository();
    const account = makeAccount();
    repo.seedAccount(account);
    await repo.upsertRule({
      connectedAccountId: account.id,
      type: "promo_archive",
      enabled: false,
      order: 0,
      config: {},
    });

    const promo = makeMessage({ threadId: "promo", category: "promotions", inInbox: true });
    const connector = new MockConnector({ now, messages: [promo] });

    await runOnce(account, connector, repo, { trigger: "manual", classifier: neverImportant, now });
    expect(connector.getState("promo")?.inInbox).toBe(true);
  });
});
