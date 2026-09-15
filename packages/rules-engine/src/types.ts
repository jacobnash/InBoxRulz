export type MessageCategory =
  | "primary"
  | "promotions"
  | "purchases"
  | "social"
  | "updates"
  | "forums";

export type RuleType =
  | "promo_archive"
  | "receipts_file"
  | "delivered_trash"
  | "retention_purge"
  | "rescue";

/**
 * Provider-agnostic view of one email thread. Adapters in
 * @inboxrulz/mail-connector are responsible for producing this shape from
 * Gmail/Graph/IMAP-specific data — the rules engine never sees a
 * provider-native object.
 */
export interface NormalizedMessage {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  /** False once the thread has been archived, trashed, or otherwise moved
   * out of the primary inbox view. */
  inInbox: boolean;
  /** The provider's own bulk-mail classification, when it has one (Gmail
   * category tabs; best-effort heuristic for IMAP/Outlook). Absent for
   * plain primary mail. */
  category?: MessageCategory;
  /** Normalized labels/folders currently on the thread, including any of
   * InboxRules' own permanent tags from `TAGS`. */
  tags: string[];
}

export type ActionType =
  | "archive"
  | "trash"
  | "label"
  | "unlabel"
  | "restore_to_inbox"
  | "mark_read";

/** One action a rule wants taken against one thread. The worker applies
 * these via the mail connector and records each as a `run_actions` row. */
export interface PlannedAction {
  ruleType: RuleType;
  threadId: string;
  action: ActionType;
  /** Required for `label`/`unlabel`. */
  label?: string;
  /** Human-readable justification — the matched query for deterministic
   * rules, the LLM's rationale for rescue. Shown in the run log. */
  reason: string;
}
