import { z } from "zod";
import { TAGS } from "./tags.js";

export const promoArchiveConfigSchema = z.object({}).strict().default({});
export type PromoArchiveConfig = z.infer<typeof promoArchiveConfigSchema>;

export const receiptsFileConfigSchema = z.object({}).strict().default({});
export type ReceiptsFileConfig = z.infer<typeof receiptsFileConfigSchema>;

export const deliveredTrashConfigSchema = z
  .object({
    /** Don't trash until N days after the message was received, as a safety
     * margin against phrase-match false positives (spec section 10). */
    gracePeriodDays: z.number().int().min(0).max(30).default(0),
    positivePhrases: z
      .array(z.string().min(1))
      .default(["has been delivered", "was delivered", "package was delivered"]),
    negativePhrases: z
      .array(z.string().min(1))
      .default(["out for delivery", "delayed", "delivery attempt", "estimated delivery"]),
  })
  .default({});
export type DeliveredTrashConfig = z.infer<typeof deliveredTrashConfigSchema>;

export const retentionPurgeConfigSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(3650).default(30),
    /** Tags that make a thread eligible for purging once it's old enough.
     * Defaults to what promo_archive applies; a periodicals/newsletter rule
     * could add its own tag here later. */
    eligibleTags: z.array(z.string().min(1)).default([TAGS.PROMO_ARCHIVED]),
  })
  .default({});
export type RetentionPurgeConfig = z.infer<typeof retentionPurgeConfigSchema>;

export const rescueConfigSchema = z
  .object({
    lookbackDays: z.number().int().min(1).max(14).default(2),
    /** Case-insensitive substring match against subject/snippet. A hit
     * short-circuits straight to "important" without calling the
     * classifier. */
    keywords: z.array(z.string().min(1)).default([]),
    /** Exact addresses or bare domains (e.g. "acme.com"). A match
     * short-circuits to "important" without calling the classifier. */
    trustedSenders: z.array(z.string().min(1)).default([]),
    /** Exact addresses or bare domains that should never be rescued —
     * skipped entirely, no classifier call. */
    ignoredSenders: z.array(z.string().min(1)).default([]),
  })
  .default({});
export type RescueConfig = z.infer<typeof rescueConfigSchema>;

export const ruleConfigSchemas = {
  promo_archive: promoArchiveConfigSchema,
  receipts_file: receiptsFileConfigSchema,
  delivered_trash: deliveredTrashConfigSchema,
  retention_purge: retentionPurgeConfigSchema,
  rescue: rescueConfigSchema,
} as const;

export type RuleConfigFor<T extends keyof typeof ruleConfigSchemas> = z.infer<
  (typeof ruleConfigSchemas)[T]
>;

/** Validates and fills in defaults for a rule's `config` JSON blob. Throws
 * a ZodError with a field-level message if the stored/submitted config is
 * malformed — call this at the API boundary (rule create/update) and again
 * before a run so a bad config never silently no-ops. */
export function parseRuleConfig<T extends keyof typeof ruleConfigSchemas>(
  type: T,
  config: unknown,
): RuleConfigFor<T> {
  return ruleConfigSchemas[type].parse(config) as RuleConfigFor<T>;
}
