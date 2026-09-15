import type { MessageCategory, NormalizedMessage, PlannedAction } from "@inboxrulz/rules-engine";

export type Provider = "gmail" | "outlook" | "icloud" | "fastmail" | "zoho" | "imap";

/**
 * A provider-agnostic description of what a rule needs to scan. Each
 * adapter translates this into its own native query (a Gmail search
 * string, a Graph filter, an IMAP SEARCH command) — the rules engine and
 * the worker never construct provider syntax themselves (spec section 6:
 * "Rules Engine translates each active rule into a provider query +
 * action").
 */
export interface MailQuery {
  /** Restrict to the inbox, to mail already moved out of it, or omit for
   * both (still excluding Trash/Spam, which no rule acts on by default —
   * see spec section 10 on Spam access). */
  location?: "inbox" | "archived";
  /** Only mail the provider classifies in this bulk-mail category. */
  category?: MessageCategory;
  /** Only mail received in the last N days (inclusive). */
  receivedWithinDays?: number;
  /** Only mail received more than N days ago — the connector may push this
   * into the provider query (e.g. Gmail's `older_than:`) as an
   * optimization; the rules engine re-checks the exact boundary itself. */
  receivedOlderThanDays?: number;
  /** Only mail carrying every one of these tags. */
  withTags?: string[];
  /** Exclude mail carrying any of these tags. */
  withoutTags?: string[];
}

/**
 * The connector layer from spec section 6/7. One implementation per
 * provider; the worker holds one instance per connected account and never
 * touches provider SDKs directly.
 */
export interface MailConnector {
  readonly provider: Provider;
  listMessages(query: MailQuery): Promise<NormalizedMessage[]>;
  applyAction(action: PlannedAction): Promise<void>;
}
