import type { NormalizedMessage, PlannedAction } from "../types.js";
import type { ReceiptsFileConfig } from "../config.js";
import { TAGS } from "../tags.js";

/**
 * Rule 2 — deterministic. Files inbox mail the provider classifies as a
 * purchase/receipt under a permanent Receipts tag and archives it out of
 * the inbox. Receipts are never trashed by any other rule (delivered_trash
 * and retention_purge both explicitly exclude TAGS.RECEIPTS) — filing is
 * forever, per spec section 4.
 */
export function planReceiptsFile(
  messages: readonly NormalizedMessage[],
  _config: ReceiptsFileConfig,
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  for (const m of messages) {
    if (!m.inInbox || m.category !== "purchases") continue;
    if (!m.tags.includes(TAGS.RECEIPTS)) {
      actions.push({
        ruleType: "receipts_file",
        threadId: m.threadId,
        action: "label",
        label: TAGS.RECEIPTS,
        reason: "Classified as Purchases by provider",
      });
    }
    actions.push({
      ruleType: "receipts_file",
      threadId: m.threadId,
      action: "archive",
      reason: "Filed under Receipts",
    });
  }
  return actions;
}
