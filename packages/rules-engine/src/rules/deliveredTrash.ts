import type { NormalizedMessage, PlannedAction } from "../types.js";
import type { DeliveredTrashConfig } from "../config.js";
import { TAGS, DAY_MS } from "../tags.js";

function includesPhrase(haystack: string, phrase: string): boolean {
  return haystack.toLowerCase().includes(phrase.toLowerCase());
}

/**
 * Rule 3 — deterministic. Trashes mail whose subject/snippet reads as a
 * completed delivery ("has been delivered"), unless a false-positive phrase
 * is also present ("out for delivery" is not yet delivered) or the thread
 * is already filed as a Receipts (rule 2 owns those — kept forever).
 *
 * `gracePeriodDays` (spec section 10, "false positives on delivered-order
 * trashing") delays the trash action for a configurable window after the
 * message arrived, giving the user time to notice a wrong match before it's
 * gone.
 */
export function planDeliveredTrash(
  messages: readonly NormalizedMessage[],
  config: DeliveredTrashConfig,
  now: Date = new Date(),
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  for (const m of messages) {
    if (m.tags.includes(TAGS.RECEIPTS)) continue;

    const haystack = `${m.subject}\n${m.snippet}`;
    const matchedPhrase = config.positivePhrases.find((phrase) => includesPhrase(haystack, phrase));
    if (!matchedPhrase) continue;
    if (config.negativePhrases.some((phrase) => includesPhrase(haystack, phrase))) continue;

    const ageMs = now.getTime() - m.receivedAt.getTime();
    if (ageMs < config.gracePeriodDays * DAY_MS) continue;

    actions.push({
      ruleType: "delivered_trash",
      threadId: m.threadId,
      action: "trash",
      reason: `Matched delivery phrase "${matchedPhrase}"`,
    });
  }
  return actions;
}
