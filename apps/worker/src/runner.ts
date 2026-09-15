import type { ConnectedAccountRecord, Repository, RuleRecord, RunTrigger } from "@inboxrulz/db";
import type { MailConnector } from "@inboxrulz/mail-connector";
import {
  TAGS,
  parseRuleConfig,
  planPromoArchive,
  planReceiptsFile,
  planDeliveredTrash,
  planRetentionPurge,
  planRescue,
  type NormalizedMessage,
  type PlannedAction,
  type RescueClassifier,
} from "@inboxrulz/rules-engine";

/** How far back delivered_trash scans for a delivery phrase. Not a user
 * knob — it's a scan-cost bound, not a product behavior (the rule itself
 * has no concept of "recent"; a delivery phrase found a year ago should
 * still trash the thread, but scanning a whole mailbox's history on every
 * run isn't worth it for mail this stale). */
const DELIVERED_TRASH_SCAN_WINDOW_DAYS = 45;

export interface RunOnceOptions {
  trigger: RunTrigger;
  classifier: RescueClassifier;
  now?: Date;
}

/**
 * Runs every enabled rule for one connected account, in order, against one
 * connector, and records everything to the run log. A rule that throws
 * doesn't stop the others — spec section 6 treats each rule as an
 * independent unit of work, and one bad query shouldn't block, say,
 * receipts filing.
 */
export async function runOnce(
  account: ConnectedAccountRecord,
  connector: MailConnector,
  repository: Repository,
  options: RunOnceOptions,
): Promise<void> {
  const now = options.now ?? new Date();
  const rules = (await repository.listRulesForAccount(account.id))
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  const run = await repository.createRun(account.id, options.trigger);
  let sawFailure = false;
  let sawSuccess = false;

  for (const rule of rules) {
    try {
      const actions = await planForRule(rule, connector, options.classifier, now);
      for (const action of actions) {
        await connector.applyAction(action);
        await repository.recordAction({
          runId: run.id,
          ruleId: rule.id,
          threadId: action.threadId,
          action: action.action,
          reason: action.reason,
        });
      }
      sawSuccess = true;
    } catch (err) {
      sawFailure = true;
      // eslint-disable-next-line no-console
      console.error(`[inboxrules] rule ${rule.type} failed for account ${account.id}:`, err);
    }
  }

  const status = sawFailure ? (sawSuccess ? "partial" : "failed") : "succeeded";
  await repository.finishRun(
    run.id,
    status,
    sawFailure ? "one or more rules failed; see worker logs for this run" : undefined,
  );
}

async function planForRule(
  rule: RuleRecord,
  connector: MailConnector,
  classifier: RescueClassifier,
  now: Date,
): Promise<PlannedAction[]> {
  switch (rule.type) {
    case "promo_archive": {
      const config = parseRuleConfig("promo_archive", rule.config);
      const messages = await connector.listMessages({ location: "inbox", category: "promotions" });
      return planPromoArchive(messages, config);
    }

    case "receipts_file": {
      const config = parseRuleConfig("receipts_file", rule.config);
      const messages = await connector.listMessages({ location: "inbox", category: "purchases" });
      return planReceiptsFile(messages, config);
    }

    case "delivered_trash": {
      const config = parseRuleConfig("delivered_trash", rule.config);
      const messages = await connector.listMessages({
        receivedWithinDays: DELIVERED_TRASH_SCAN_WINDOW_DAYS,
        withoutTags: [TAGS.RECEIPTS],
      });
      return planDeliveredTrash(messages, config, now);
    }

    case "retention_purge": {
      const config = parseRuleConfig("retention_purge", rule.config);
      // Eligible tags are OR'd together, but MailQuery.withTags is an AND
      // match — query once per tag and de-dupe by thread.
      const byThread = new Map<string, NormalizedMessage>();
      for (const tag of config.eligibleTags) {
        const messages = await connector.listMessages({
          location: "archived",
          withTags: [tag],
          receivedOlderThanDays: config.retentionDays,
        });
        for (const message of messages) byThread.set(message.threadId, message);
      }
      return planRetentionPurge([...byThread.values()], config, now);
    }

    case "rescue": {
      const config = parseRuleConfig("rescue", rule.config);
      const messages = await connector.listMessages({
        location: "archived",
        receivedWithinDays: config.lookbackDays,
        withoutTags: [TAGS.RESCUED],
      });
      return planRescue(messages, config, classifier, now);
    }
  }
}
