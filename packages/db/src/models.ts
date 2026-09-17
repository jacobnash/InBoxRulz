// Hand-written domain types mirroring prisma/schema.prisma. Kept independent
// of the generated Prisma Client so packages that only need the shapes (not
// a live database) — the rules engine, the worker's pure orchestration
// logic, tests — don't need `prisma generate` to have been run.

// Exported as const arrays (not just union types) so callers that need a
// runtime list — zod enums at the API boundary, in particular — don't have
// to redeclare the set of valid values by hand.
export const PROVIDERS = ["gmail", "outlook", "icloud", "fastmail", "zoho", "imap"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ACCOUNT_STATUSES = ["pending", "active", "needs_reauth", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const RULE_TYPES = [
  "promo_archive",
  "receipts_file",
  "delivered_trash",
  "retention_purge",
  "rescue",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RUN_STATUSES = ["running", "succeeded", "failed", "partial"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ["scheduled", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const ACTION_TYPES = [
  "archive",
  "trash",
  "label",
  "unlabel",
  "restore_to_inbox",
  "mark_read",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface ConnectedAccountRecord {
  id: string;
  userId: string;
  provider: Provider;
  displayName: string;
  /** Sealed with encryptCredentials/decryptCredentials from ./crypto — never
   * plaintext, even in memory longer than a single connector call needs. */
  encryptedCredentials: string;
  status: AccountStatus;
  connectedAt: Date;
}

export interface RuleRecord {
  id: string;
  connectedAccountId: string;
  type: RuleType;
  enabled: boolean;
  /** Execution order within an account's rule set (ascending). */
  order: number;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunRecord {
  id: string;
  connectedAccountId: string;
  trigger: RunTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  error: string | null;
}

export interface RunActionRecord {
  id: string;
  runId: string;
  ruleId: string;
  threadId: string;
  action: ActionType;
  reason: string;
  createdAt: Date;
}
