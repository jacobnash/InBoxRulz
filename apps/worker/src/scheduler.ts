import cron, { type ScheduledTask } from "node-cron";
import type { ConnectedAccountRecord, Repository } from "@inboxrulz/db";
import type { MailConnector } from "@inboxrulz/mail-connector";
import type { RescueClassifier } from "@inboxrulz/rules-engine";
import { runOnce } from "./runner.js";

export interface WorkerDeps {
  repository: Repository;
  classifier: RescueClassifier;
  connectorFor: (account: ConnectedAccountRecord) => MailConnector;
}

/** Default daily run time: 6am. Per-account overrides aren't implemented
 * yet — everyone runs on the same schedule until there's a reason (timezone
 * preference, rate-limit spreading) to stagger it. */
export const DEFAULT_CRON_SCHEDULE = "0 6 * * *";

/** Runs every active connected account once. One account's failure (a
 * revoked token, a provider outage) is isolated and doesn't block the rest
 * — each account gets its own run log entry either way. */
export async function runAllActiveAccounts(deps: WorkerDeps, now?: Date): Promise<void> {
  const accounts = await deps.repository.listActiveConnectedAccounts();
  for (const account of accounts) {
    try {
      const connector = deps.connectorFor(account);
      await runOnce(account, connector, deps.repository, {
        trigger: "scheduled",
        classifier: deps.classifier,
        now,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[inboxrules] scheduled run failed to start for account ${account.id}:`, err);
    }
  }
}

/** The "Run now" path (spec section 5, MVP feature list) — same orchestration,
 * triggered on demand for one account instead of the daily sweep. */
export async function runAccountNow(accountId: string, deps: WorkerDeps): Promise<void> {
  const account = await deps.repository.getConnectedAccount(accountId);
  if (!account) throw new Error(`Unknown connected account ${accountId}`);
  const connector = deps.connectorFor(account);
  await runOnce(account, connector, deps.repository, {
    trigger: "manual",
    classifier: deps.classifier,
  });
}

export function scheduleDailyRuns(
  deps: WorkerDeps,
  cronExpression: string = DEFAULT_CRON_SCHEDULE,
): ScheduledTask {
  return cron.schedule(cronExpression, () => {
    runAllActiveAccounts(deps).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[inboxrules] scheduled sweep failed:", err);
    });
  });
}
