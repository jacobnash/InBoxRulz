/**
 * Tags InboxRules itself applies. These are the "permanent tags" from the
 * spec: once one of these lands on a thread it is used by other rules as a
 * durable signal, so a judgment call never has to be re-made (see
 * `planRescue` for the idempotency check this exists to support).
 */
export const TAGS = {
  /** Applied by promo_archive so retention_purge knows this thread is
   * eligible for aging out, without retention_purge needing its own
   * classification logic. */
  PROMO_ARCHIVED: "InboxRules/PromoArchived",
  /** Applied by receipts_file. Receipts are excluded from delivered_trash
   * (already filed, not "clutter") and from retention_purge (kept forever). */
  RECEIPTS: "InboxRules/Receipts",
  /** Applied whenever rescue restores a thread to the inbox. Prevents the
   * rule from re-considering the same thread if the user archives it again
   * later — that would otherwise be an infinite rescue/re-archive loop. */
  RESCUED: "InboxRules/Rescued",
} as const;

export type PermanentTag = (typeof TAGS)[keyof typeof TAGS];

export const DAY_MS = 24 * 60 * 60 * 1000;
