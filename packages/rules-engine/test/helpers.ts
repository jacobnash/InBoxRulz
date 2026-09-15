import type { NormalizedMessage } from "../src/types.js";

let counter = 0;

export function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  counter += 1;
  return {
    threadId: `thread-${counter}`,
    from: "Sender <sender@example.com>",
    subject: "Subject",
    snippet: "Snippet",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    inInbox: true,
    tags: [],
    ...overrides,
  };
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
