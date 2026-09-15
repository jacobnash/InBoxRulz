import { InMemoryRepository } from "@inboxrulz/db";
import { createConnectorForAccount, createAnthropicRescueClassifier, heuristicRescueClassifier } from "@inboxrulz/worker";
import { buildServer } from "./server.js";

/**
 * Standalone API process. Shares the same in-memory-Repository caveat as
 * apps/worker/src/main.ts — see that file's comment. Running the API and
 * worker as separate processes against the *same* database is what makes
 * "connect an account here, see it run over there" actually work; today
 * they'd each hold their own disconnected in-memory store. That wiring
 * (a shared Postgres-backed Repository) is the integration piece a real
 * deployment still needs.
 */
const repository = new InMemoryRepository();

const classifier = process.env.ANTHROPIC_API_KEY
  ? createAnthropicRescueClassifier({ apiKey: process.env.ANTHROPIC_API_KEY })
  : heuristicRescueClassifier;

const app = buildServer({
  repository,
  classifier,
  connectorFor: (account) => createConnectorForAccount(account),
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[inboxrules] api listening on ${address}`);
});
