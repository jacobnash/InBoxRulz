import type { NormalizedMessage, PlannedAction } from "../types.js";
import type { RescueConfig } from "../config.js";
import { TAGS, DAY_MS } from "../tags.js";
import { matchesSenderList } from "../senderMatch.js";

export interface RescueClassification {
  important: boolean;
  /** Rationale shown in the run log — required even for `important: false`
   * so a "why didn't this get rescued" question is answerable. */
  reason: string;
}

/**
 * The one judgment-based piece of the product (spec section 4, rule 5).
 * Implementations may call an LLM, a learned classifier, or anything else;
 * the rules engine only depends on this signature so the expensive
 * fuzzy logic stays swappable and testable in isolation (see
 * `mockClassifier` in the test suite).
 */
export type RescueClassifier = (
  message: NormalizedMessage,
  config: RescueConfig,
) => Promise<RescueClassification> | RescueClassification;

/**
 * Rule 5 — judgment-based. Scans mail that left the inbox within
 * `lookbackDays` for signals it shouldn't have, and restores it.
 *
 * Cost control: a trusted sender or keyword hit short-circuits to
 * "important" without invoking the classifier at all — the design
 * principle from spec section 4 is "don't run an LLM over every message,
 * only over the narrow question that's actually fuzzy."
 *
 * Idempotency: once a thread is restored it's tagged TAGS.RESCUED, and any
 * thread already carrying that tag is skipped outright — including a call
 * to the classifier. Without this, a user who re-archives a rescued thread
 * would put it right back in the next run's candidate set and the rule
 * would re-rescue it forever.
 */
export async function planRescue(
  messages: readonly NormalizedMessage[],
  config: RescueConfig,
  classify: RescueClassifier,
  now: Date = new Date(),
): Promise<PlannedAction[]> {
  const lookbackMs = config.lookbackDays * DAY_MS;
  const actions: PlannedAction[] = [];

  for (const m of messages) {
    if (m.inInbox) continue;
    if (m.tags.includes(TAGS.RESCUED)) continue;

    const ageMs = now.getTime() - m.receivedAt.getTime();
    if (ageMs > lookbackMs) continue;

    if (matchesSenderList(m.from, config.ignoredSenders)) continue;

    let result: RescueClassification;
    if (matchesSenderList(m.from, config.trustedSenders)) {
      result = { important: true, reason: "Sender is on the trusted list" };
    } else {
      const matchedKeyword = config.keywords.find((kw) =>
        `${m.subject}\n${m.snippet}`.toLowerCase().includes(kw.toLowerCase()),
      );
      if (matchedKeyword) {
        result = { important: true, reason: `Matched keyword "${matchedKeyword}"` };
      } else {
        result = await classify(m, config);
      }
    }

    if (!result.important) continue;

    actions.push({
      ruleType: "rescue",
      threadId: m.threadId,
      action: "restore_to_inbox",
      reason: result.reason,
    });
    actions.push({
      ruleType: "rescue",
      threadId: m.threadId,
      action: "label",
      label: TAGS.RESCUED,
      reason: "Tagged so this thread is never re-evaluated by rescue again",
    });
  }

  return actions;
}
