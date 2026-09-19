import { InMemoryRepository, PostgresRepository, createPrismaClient, type Repository } from "@inboxrulz/db";
import { readSecret, requireSecret } from "@inboxrulz/config";
import { createLogger } from "@inboxrulz/logger";
import { createConnectorForAccount, createAnthropicRescueClassifier, heuristicRescueClassifier } from "@inboxrulz/worker";
import { createFirebaseIdTokenVerifier } from "./firebaseAuth.js";
import { createGoogleOAuth } from "./googleOAuth.js";
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
const logger = createLogger("api");

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
if (!firebaseProjectId) {
  throw new Error(
    "FIREBASE_PROJECT_ID is not set. This is the Firebase project's id (public config, not a " +
      "secret) — the same one the dashboard's Firebase client config uses.",
  );
}

const databaseUrl = readSecret("DATABASE_URL");
const repository: Repository = databaseUrl
  ? new PostgresRepository(createPrismaClient(databaseUrl))
  : new InMemoryRepository();
if (!databaseUrl) {
  logger.warn("DATABASE_URL not set — using an in-memory store (state resets on restart, not shared with the worker).");
}
const credentialsEncryptionKey = requireSecret("CREDENTIALS_ENCRYPTION_KEY");
const anthropicApiKey = readSecret("ANTHROPIC_API_KEY");

const classifier = anthropicApiKey
  ? createAnthropicRescueClassifier({ apiKey: anthropicApiKey })
  : heuristicRescueClassifier;
if (!anthropicApiKey) {
  logger.warn("ANTHROPIC_API_KEY not set — rescue rule is using the conservative heuristic fallback, not an LLM.");
}

const googleOAuthClientId = readSecret("GOOGLE_OAUTH_CLIENT_ID");
const googleOAuthClientSecret = readSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const googleOAuthRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
const googleOAuth =
  googleOAuthClientId && googleOAuthClientSecret && googleOAuthRedirectUri
    ? createGoogleOAuth({
        clientId: googleOAuthClientId,
        clientSecret: googleOAuthClientSecret,
        redirectUri: googleOAuthRedirectUri,
      })
    : undefined;
if (!googleOAuth) {
  logger.warn(
    "GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI not fully set — /auth/google/* will 501; " +
      "connecting a Gmail account falls back to the manual paste-credentials form.",
  );
}

const app = buildServer({
  repository,
  classifier,
  connectorFor: (account) => createConnectorForAccount(account),
  verifyIdToken: createFirebaseIdTokenVerifier(firebaseProjectId),
  logger,
  credentialsEncryptionKey,
  googleOAuth,
  webAppUrl: process.env.WEB_APP_URL,
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    logger.error({ err }, "api failed to start");
    process.exit(1);
  }
  logger.info({ address }, "api listening");
});
