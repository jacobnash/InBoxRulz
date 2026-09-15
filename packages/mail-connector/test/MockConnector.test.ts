import { describe, expect, it } from "vitest";
import { MockConnector } from "../src/mock/MockConnector.js";
import type { NormalizedMessage } from "@inboxrulz/rules-engine";

const now = new Date("2026-02-01T00:00:00Z");

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    threadId: "t1",
    from: "a@b.com",
    subject: "s",
    snippet: "sn",
    receivedAt: now,
    inInbox: true,
    tags: [],
    ...overrides,
  };
}

describe("MockConnector", () => {
  it("filters by location, category, and tags", async () => {
    const connector = new MockConnector({
      now,
      messages: [
        makeMessage({ threadId: "promo", category: "promotions", inInbox: true }),
        makeMessage({ threadId: "archived", inInbox: false }),
        makeMessage({ threadId: "tagged", tags: ["foo"] }),
      ],
    });

    expect((await connector.listMessages({ location: "inbox" })).map((m) => m.threadId).sort()).toEqual(
      ["promo", "tagged"],
    );
    expect(await connector.listMessages({ category: "promotions" })).toHaveLength(1);
    expect(await connector.listMessages({ withTags: ["foo"] })).toHaveLength(1);
    expect(await connector.listMessages({ withoutTags: ["foo"] })).toHaveLength(2);
  });

  it("applies archive/trash/restore/label actions", async () => {
    const connector = new MockConnector({ now, messages: [makeMessage({ threadId: "t1" })] });

    await connector.applyAction({ ruleType: "promo_archive", threadId: "t1", action: "archive", reason: "x" });
    expect(connector.getState("t1")?.inInbox).toBe(false);

    await connector.applyAction({
      ruleType: "receipts_file",
      threadId: "t1",
      action: "label",
      label: "InboxRules/Receipts",
      reason: "x",
    });
    expect(connector.getState("t1")?.tags).toContain("InboxRules/Receipts");

    await connector.applyAction({ ruleType: "rescue", threadId: "t1", action: "restore_to_inbox", reason: "x" });
    expect(connector.getState("t1")?.inInbox).toBe(true);

    await connector.applyAction({ ruleType: "retention_purge", threadId: "t1", action: "trash", reason: "x" });
    expect(connector.getState("t1")).toBeUndefined();
  });

  it("throws applying an action to an unknown thread", async () => {
    const connector = new MockConnector({ now });
    await expect(
      connector.applyAction({ ruleType: "promo_archive", threadId: "missing", action: "archive", reason: "x" }),
    ).rejects.toThrow(/Unknown thread/);
  });
});
