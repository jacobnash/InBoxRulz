import type { NormalizedMessage, PlannedAction } from "../types.js";
import type { RetentionPurgeConfig } from "../config.js";
import { TAGS, DAY_MS } from "../tags.js";

/**
 * Rule 4 — deterministic. Trashes mail already filed out of the inbox by an
 * eligible rule (promo_archive by default) once it's older than
 * `retentionDays`. Ages off "received date", not "date archived" — no
 * provider exposes the latter, and this matches what's expressible as a
 * provider search query (e.g. Gmail's `older_than:30d`).
 *
 * Two-stage deletion by design (spec section 4): this only moves mail to
 * the provider's own Trash, which the provider then expires on its own
 * timeline (~30 days for Gmail), so nothing InboxRules touches is
 * unrecoverable inside roughly 60 days without the user noticing.
 */
export function planRetentionPurge(
  messages: readonly NormalizedMessage[],
  config: RetentionPurgeConfig,
  now: Date = new Date(),
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const thresholdMs = config.retentionDays * DAY_MS;
  for (const m of messages) {
    if (m.inInbox) continue;
    if (m.tags.includes(TAGS.RECEIPTS)) continue; // receipts are kept forever
    if (!config.eligibleTags.some((tag) => m.tags.includes(tag))) continue;

    const ageMs = now.getTime() - m.receivedAt.getTime();
    if (ageMs < thresholdMs) continue;

    actions.push({
      ruleType: "retention_purge",
      threadId: m.threadId,
      action: "trash",
      reason: `Archived and older than ${config.retentionDays} days`,
    });
  }
  return actions;
}
