import { describe, expect, it, vi, beforeEach } from "vitest";
import type { gmail_v1 } from "googleapis";
import { GmailConnector } from "../src/gmail/GmailConnector.js";
import type { PlannedAction } from "@inboxrulz/rules-engine";

function makeFakeGmailClient() {
  const labels = [
    { id: "Label_1", name: "InboxRules/Receipts", type: "user" },
    { id: "INBOX", name: "INBOX", type: "system" },
  ];

  const threadsGetById: Record<string, gmail_v1.Schema$Thread> = {
    "thread-1": {
      id: "thread-1",
      snippet: "hi",
      messages: [
        {
          id: "m1",
          labelIds: ["INBOX"],
          internalDate: "0",
          payload: { headers: [{ name: "Subject", value: "Hello" }] },
        },
      ],
    },
  };

  const client = {
    users: {
      threads: {
        list: vi.fn(async () => ({ data: { threads: [{ id: "thread-1" }] } })),
        get: vi.fn(async ({ id }: { id: string }) => ({ data: threadsGetById[id] })),
        modify: vi.fn(async () => ({ data: {} })),
        trash: vi.fn(async () => ({ data: {} })),
      },
      labels: {
        list: vi.fn(async () => ({ data: { labels } })),
        create: vi.fn(async ({ requestBody }: { requestBody: { name: string } }) => ({
          data: { id: "Label_new", name: requestBody.name },
        })),
      },
    },
  } as unknown as gmail_v1.Gmail;

  return client;
}

describe("GmailConnector", () => {
  let client: gmail_v1.Gmail;
  let connector: GmailConnector;

  beforeEach(() => {
    client = makeFakeGmailClient();
    connector = new GmailConnector({ client });
  });

  it("throws if constructed without auth or a client", () => {
    expect(() => new GmailConnector({})).toThrow();
  });

  it("lists and normalizes messages", async () => {
    const messages = await connector.listMessages({ location: "inbox" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ threadId: "thread-1", subject: "Hello", inInbox: true });
    expect(client.users.threads.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining("in:inbox") }),
    );
  });

  it("archives by removing the INBOX label", async () => {
    const action: PlannedAction = {
      ruleType: "promo_archive",
      threadId: "thread-1",
      action: "archive",
      reason: "test",
    };
    await connector.applyAction(action);
    expect(client.users.threads.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thread-1",
        requestBody: { removeLabelIds: ["INBOX"] },
      }),
    );
  });

  it("trashes via the dedicated trash endpoint", async () => {
    await connector.applyAction({
      ruleType: "retention_purge",
      threadId: "thread-1",
      action: "trash",
      reason: "test",
    });
    expect(client.users.threads.trash).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread-1" }),
    );
  });

  it("resolves an existing label to its id without creating a new one", async () => {
    await connector.applyAction({
      ruleType: "receipts_file",
      threadId: "thread-1",
      action: "label",
      label: "InboxRules/Receipts",
      reason: "test",
    });
    expect(client.users.labels.create).not.toHaveBeenCalled();
    expect(client.users.threads.modify).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { addLabelIds: ["Label_1"] } }),
    );
  });

  it("creates a label that doesn't exist yet, then reuses it", async () => {
    const action: PlannedAction = {
      ruleType: "rescue",
      threadId: "thread-1",
      action: "label",
      label: "InboxRules/Rescued",
      reason: "test",
    };
    await connector.applyAction(action);
    expect(client.users.labels.create).toHaveBeenCalledTimes(1);

    await connector.applyAction(action);
    expect(client.users.labels.create).toHaveBeenCalledTimes(1); // cached, not re-created
  });

  it("throws when a label action is missing a label", async () => {
    await expect(
      connector.applyAction({
        ruleType: "rescue",
        threadId: "thread-1",
        action: "label",
        reason: "test",
      }),
    ).rejects.toThrow(/missing a label/);
  });
});
