import type { NormalizedMessage, PlannedAction } from "../types.js";
import type { PromoArchiveConfig } from "../config.js";
import { TAGS } from "../tags.js";

/**
 * Rule 1 — deterministic. Archives inbox mail the provider itself has
 * already classified as promotional (Gmail `category:promotions`; adapters
 * for providers without a native category tab approximate this with
 * heuristics before messages ever reach this function).
 *
 * Also tags the thread PROMO_ARCHIVED so retention_purge can later find it
 * without re-deriving "this was promo mail" — the tag is the durable
 * record of that classification.
 */
export function planPromoArchive(
  messages: readonly NormalizedMessage[],
  _config: PromoArchiveConfig,
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  for (const m of messages) {
    if (!m.inInbox || m.category !== "promotions") continue;
    actions.push({
      ruleType: "promo_archive",
      threadId: m.threadId,
      action: "archive",
      reason: "Classified as Promotions by provider",
    });
    if (!m.tags.includes(TAGS.PROMO_ARCHIVED)) {
      actions.push({
        ruleType: "promo_archive",
        threadId: m.threadId,
        action: "label",
        label: TAGS.PROMO_ARCHIVED,
        reason: "Tagged so retention_purge can age this thread out later",
      });
    }
  }
  return actions;
}
