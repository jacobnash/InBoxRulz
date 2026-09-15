import { describe, expect, it } from "vitest";
import type { gmail_v1 } from "googleapis";
import { normalizeGmailThread } from "../src/gmail/normalize.js";

function makeThread(overrides: Partial<gmail_v1.Schema$Thread> = {}): gmail_v1.Schema$Thread {
  return {
    id: "thread-1",
    snippet: "thread snippet",
    messages: [
      {
        id: "msg-1",
        labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
        internalDate: String(Date.parse("2026-01-01T00:00:00Z")),
        payload: {
          headers: [
            { name: "From", value: "Deals <deals@example.com>" },
            { name: "Subject", value: "50% off everything" },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("normalizeGmailThread", () => {
  it("maps headers, category, inbox state, and receivedAt", () => {
    const result = normalizeGmailThread(makeThread(), new Map());
    expect(result).toMatchObject({
      threadId: "thread-1",
      from: "Deals <deals@example.com>",
      subject: "50% off everything",
      snippet: "thread snippet",
      inInbox: true,
      category: "promotions",
    });
    expect(result?.receivedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("maps custom label ids to tag names", () => {
    const thread = makeThread({
      messages: [
        {
          id: "msg-1",
          labelIds: ["Label_1", "Label_2"],
          internalDate: "0",
          payload: { headers: [] },
        },
      ],
    });
    const labelMap = new Map([
      ["Label_1", "InboxRules/Receipts"],
      ["Label_2", "some-other-custom-label"],
    ]);
    const result = normalizeGmailThread(thread, labelMap);
    expect(result?.tags).toEqual(["InboxRules/Receipts", "some-other-custom-label"]);
    expect(result?.inInbox).toBe(false);
  });

  it("falls back to the query category for categories with no persistent label (e.g. purchases)", () => {
    const thread = makeThread({
      messages: [{ id: "msg-1", labelIds: ["INBOX"], internalDate: "0", payload: { headers: [] } }],
    });
    const result = normalizeGmailThread(thread, new Map(), "purchases");
    expect(result?.category).toBe("purchases");
  });

  it("uses the latest message in a multi-message thread", () => {
    const thread = makeThread({
      messages: [
        {
          id: "msg-1",
          labelIds: ["INBOX"],
          internalDate: "0",
          payload: { headers: [{ name: "Subject", value: "old" }] },
        },
        {
          id: "msg-2",
          labelIds: [],
          internalDate: "1000",
          payload: { headers: [{ name: "Subject", value: "newest" }] },
        },
      ],
    });
    const result = normalizeGmailThread(thread, new Map());
    expect(result?.subject).toBe("newest");
    expect(result?.inInbox).toBe(false);
  });

  it("returns null for a thread with no messages", () => {
    expect(normalizeGmailThread({ id: "empty" }, new Map())).toBeNull();
  });
});
