import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { NormalizedMessage, PlannedAction } from "@inboxrulz/rules-engine";
import type { MailConnector, MailQuery } from "../types.js";
import { buildGmailSearchQuery } from "./query.js";
import { normalizeGmailThread } from "./normalize.js";

export interface GmailConnectorOptions {
  /** An OAuth2Client already loaded with this account's tokens (decrypted
   * by the caller — this class never touches encrypted credentials). */
  auth?: OAuth2Client;
  /** Inject a pre-built client directly — used by tests, and available for
   * callers that already manage their own googleapis client pool. */
  client?: gmail_v1.Gmail;
}

const MAX_RESULTS_PER_QUERY = 100;

export class GmailConnector implements MailConnector {
  readonly provider = "gmail" as const;
  private readonly gmail: gmail_v1.Gmail;
  private labelIdToName: Map<string, string> | null = null;
  private labelNameToId: Map<string, string> | null = null;

  constructor(options: GmailConnectorOptions) {
    if (!options.client && !options.auth) {
      throw new Error("GmailConnector requires either `auth` or `client`.");
    }
    this.gmail = options.client ?? google.gmail({ version: "v1", auth: options.auth });
  }

  async listMessages(query: MailQuery): Promise<NormalizedMessage[]> {
    const labelIdToTag = await this.getCustomLabelMap();
    const q = buildGmailSearchQuery(query);
    const listRes = await this.gmail.users.threads.list({
      userId: "me",
      q,
      maxResults: MAX_RESULTS_PER_QUERY,
    });
    const threads = listRes.data.threads ?? [];

    const fetched = await Promise.all(
      threads.map((t) =>
        this.gmail.users.threads.get({
          userId: "me",
          id: t.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject"],
        }),
      ),
    );

    return fetched
      .map((res) => normalizeGmailThread(res.data, labelIdToTag, query.category))
      .filter((m): m is NormalizedMessage => m !== null);
  }

  async applyAction(action: PlannedAction): Promise<void> {
    switch (action.action) {
      case "archive":
        await this.modify(action.threadId, { removeLabelIds: ["INBOX"] });
        return;
      case "trash":
        await this.gmail.users.threads.trash({ userId: "me", id: action.threadId });
        return;
      case "restore_to_inbox":
        await this.modify(action.threadId, { addLabelIds: ["INBOX"] });
        return;
      case "mark_read":
        await this.modify(action.threadId, { removeLabelIds: ["UNREAD"] });
        return;
      case "label": {
        const labelId = await this.getOrCreateLabelId(requireLabel(action));
        await this.modify(action.threadId, { addLabelIds: [labelId] });
        return;
      }
      case "unlabel": {
        const labelId = await this.getOrCreateLabelId(requireLabel(action));
        await this.modify(action.threadId, { removeLabelIds: [labelId] });
        return;
      }
    }
  }

  private async modify(
    threadId: string,
    body: gmail_v1.Schema$ModifyThreadRequest,
  ): Promise<void> {
    await this.gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: body });
  }

  private async getCustomLabelMap(): Promise<Map<string, string>> {
    if (this.labelIdToName) return this.labelIdToName;
    await this.loadLabels();
    return this.labelIdToName!;
  }

  private async getOrCreateLabelId(name: string): Promise<string> {
    if (!this.labelNameToId) await this.loadLabels();
    const existing = this.labelNameToId!.get(name);
    if (existing) return existing;

    const created = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    const id = created.data.id!;
    this.labelNameToId!.set(name, id);
    this.labelIdToName!.set(id, name);
    return id;
  }

  private async loadLabels(): Promise<void> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    const idToName = new Map<string, string>();
    const nameToId = new Map<string, string>();
    for (const label of res.data.labels ?? []) {
      if (label.type !== "user" || !label.id || !label.name) continue;
      idToName.set(label.id, label.name);
      nameToId.set(label.name, label.id);
    }
    this.labelIdToName = idToName;
    this.labelNameToId = nameToId;
  }
}

function requireLabel(action: PlannedAction): string {
  if (!action.label) {
    throw new Error(`Action "${action.action}" on thread ${action.threadId} is missing a label.`);
  }
  return action.label;
}
