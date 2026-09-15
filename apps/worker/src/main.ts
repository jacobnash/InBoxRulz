import { InMemoryRepository } from "@inboxrulz/db";
import { createConnectorForAccount } from "./connectorFactory.js";
import { createAnthropicRescueClassifier, heuristicRescueClassifier } from "./rescueClassifier.js";
import { scheduleDailyRuns, DEFAULT_CRON_SCHEDULE, type WorkerDeps } from "./scheduler.js";

/**
 * Standalone worker process. Wires the pieces from spec section 6 together:
 * scheduler -> runner -> rules engine -> mail connector -> repository.
 *
 * NOTE: this uses the in-memory Repository, which does not persist across
 * restarts and isn't shared with the API process. It's here so the worker
 * is runnable and demoable end-to-end today; swapping in a Postgres-backed
 * `Repository` (implementing the same interface from @inboxrulz/db) behind
 * this same wiring, shared with apps/api, is the integration piece a real
 * deployment still needs — see docs/spec.md section 6 and the root README.
 */
const repository = new InMemoryRepository();

const classifier = process.env.ANTHROPIC_API_KEY
  ? createAnthropicRescueClassifier({ apiKey: process.env.ANTHROPIC_API_KEY })
  : heuristicRescueClassifier;

if (classifier === heuristicRescueClassifier) {
  // eslint-disable-next-line no-console
  console.warn(
    "[inboxrules] ANTHROPIC_API_KEY not set — rescue rule is using the conservative heuristic fallback, not an LLM.",
  );
}

const deps: WorkerDeps = {
  repository,
  classifier,
  connectorFor: (account) => createConnectorForAccount(account),
};

const cronExpression = process.env.CRON_SCHEDULE ?? DEFAULT_CRON_SCHEDULE;
scheduleDailyRuns(deps, cronExpression);
// eslint-disable-next-line no-console
console.log(`[inboxrules] worker started, scheduled runs on "${cronExpression}"`);
