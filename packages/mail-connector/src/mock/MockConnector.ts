import type { NormalizedMessage, PlannedAction } from "@inboxrulz/rules-engine";
import type { MailConnector, MailQuery, Provider } from "../types.js";
import { DAY_MS } from "@inboxrulz/rules-engine";

/**
 * In-memory `MailConnector` for tests and offline demos. Seed it with
 * `NormalizedMessage`s and it applies query filtering and actions exactly
 * like a real provider would, without any network access or credentials —
 * this is what lets the worker's orchestration logic be exercised
 * end-to-end in this sandbox.
 */
export class MockConnector implements MailConnector {
  readonly provider: Provider;
  private messages: Map<string, NormalizedMessage>;
  private now: Date;

  constructor(options: { provider?: Provider; messages?: NormalizedMessage[]; now?: Date } = {}) {
    this.provider = options.provider ?? "gmail";
    this.messages = new Map((options.messages ?? []).map((m) => [m.threadId, { ...m }]));
    this.now = options.now ?? new Date();
  }

  seed(message: NormalizedMessage): void {
    this.messages.set(message.threadId, { ...message });
  }

  getState(threadId: string): NormalizedMessage | undefined {
    return this.messages.get(threadId);
  }

  async listMessages(query: MailQuery): Promise<NormalizedMessage[]> {
    return [...this.messages.values()].filter((m) => matches(m, query, this.now));
  }

  async applyAction(action: PlannedAction): Promise<void> {
    const message = this.messages.get(action.threadId);
    if (!message) {
      throw new Error(`Unknown thread ${action.threadId}`);
    }
    switch (action.action) {
      case "archive":
        message.inInbox = false;
        return;
      case "trash":
        this.messages.delete(action.threadId);
        return;
      case "restore_to_inbox":
        message.inInbox = true;
        return;
      case "mark_read":
        return;
      case "label":
        if (action.label && !message.tags.includes(action.label)) {
          message.tags = [...message.tags, action.label];
        }
        return;
      case "unlabel":
        if (action.label) {
          message.tags = message.tags.filter((t) => t !== action.label);
        }
        return;
    }
  }
}

function matches(message: NormalizedMessage, query: MailQuery, now: Date): boolean {
  if (query.location === "inbox" && !message.inInbox) return false;
  if (query.location === "archived" && message.inInbox) return false;
  if (query.category && message.category !== query.category) return false;

  const ageMs = now.getTime() - message.receivedAt.getTime();
  if (query.receivedWithinDays !== undefined && ageMs > query.receivedWithinDays * DAY_MS) {
    return false;
  }
  if (query.receivedOlderThanDays !== undefined && ageMs < query.receivedOlderThanDays * DAY_MS) {
    return false;
  }
  if (query.withTags?.some((tag) => !message.tags.includes(tag))) return false;
  if (query.withoutTags?.some((tag) => message.tags.includes(tag))) return false;

  return true;
}
