import type { Logger } from "pino";

/**
 * The vocabulary of security-relevant events this product audits. This is
 * deliberately a closed list, not a free-form string — an audit trail is
 * only useful if every event in it was a considered addition, not
 * whatever string a call site happened to pass.
 */
export type AuditAction =
  | "auth.failed"
  | "access.denied"
  | "account.connected"
  | "account.status_changed"
  | "rule.updated"
  | "run.triggered"
  | "run.completed";

export interface AuditEvent {
  action: AuditAction;
  /** The authenticated principal performing the action — omitted only for
   * `auth.failed`, where there isn't one yet. */
  actorUserId?: string;
  resourceType?: "connected_account" | "rule" | "run";
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  /** Extra context (e.g. which fields changed on a rule). Passes through
   * the logger's redaction, so it's safe to include request-adjacent data
   * here, but never raw credentials or tokens. */
  meta?: Record<string, unknown>;
}

/**
 * Writes one structured audit record. This is distinct from the product's
 * own `run_actions` log (what a rule did to a user's mail) — this is the
 * security audit trail (who did what to the system itself: logged in,
 * connected an account, changed a rule, triggered a run) that a SOC2-style
 * review actually asks for evidence of.
 */
export function auditLog(logger: Logger, event: AuditEvent): void {
  logger.info({ audit: true, ...event }, `audit: ${event.action}`);
}
