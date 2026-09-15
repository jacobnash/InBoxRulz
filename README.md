# InboxRules

Multi-tenant inbox-hygiene automation: five rule types (four deterministic,
one LLM-judgment) keep every connected mailbox down to "does this need my
attention," with every action logged and inspectable. See
[`docs/spec.md`](docs/spec.md) for the full product/technical spec this
implements.

## Architecture

A pnpm monorepo, following the spec's build order (fork/build the connector
layer and deterministic rules engine first, dashboard next, LLM rescue rule
last):

```
packages/
  rules-engine/    Pure, provider-agnostic rule logic (the 5 rule types)
  mail-connector/  MailConnector interface + Gmail adapter + in-memory mock
  db/              Data model, credential encryption, Repository port
  config/          Secret loading (env var, or Docker-secrets-file convention)
  logger/          Structured JSON logging + the security audit trail
apps/
  worker/          Run orchestrator + daily scheduler + rescue classifiers
  api/             REST API (Fastify): auth, connect accounts, rule CRUD, run log
  web/             Dashboard (Next.js): sign-in, inbox list, rule toggles, run log
```

### Design choices worth knowing about

- **Rules engine is pure and provider-agnostic.** `planPromoArchive`,
  `planReceiptsFile`, `planDeliveredTrash`, `planRetentionPurge`, and
  `planRescue` take normalized messages in and return planned actions out —
  no provider SDK, no database, no I/O. That's what makes the 28 tests in
  `packages/rules-engine` fast and exhaustive (false-positive phrase
  exclusions, retention boundary math, the rescue permanent-tag idempotency
  that stops a re-archive/re-rescue loop).
- **Ports and adapters for persistence.** `packages/db` defines a
  `Repository` interface and ships `InMemoryRepository`, a fully-working
  reference implementation, alongside the canonical `prisma/schema.prisma`.
  Nothing in this repo depends on a generated Prisma client or a live
  Postgres instance — every package's tests run against the in-memory
  implementation. **The main integration work left before a real deployment
  is a `Repository` implementation backed by Postgres/Prisma**, used by both
  `apps/api` and `apps/worker` so they share state (today each process's
  `main.ts` builds its own throwaway in-memory store — see the comments
  there).
- **Only Gmail is wired up.** `GmailConnector` implements the full
  `MailConnector` interface against the real Gmail API (query translation,
  label resolution/creation, thread normalization). Outlook/IMAP accounts
  are representable in the data model and provider enum already; adding
  their adapters behind the same interface is the next slice of work, not a
  redesign (spec build order item 1).
- **Rescue rule cost control.** `planRescue` only calls the classifier for
  candidates a trusted sender or keyword can't already resolve, and skips
  ignored senders and already-tagged threads outright — see
  `packages/rules-engine/src/rules/rescue.ts`. `apps/worker` ships both a
  zero-dependency heuristic fallback and a Claude-backed classifier
  (`ANTHROPIC_API_KEY`).
- **Auth is real, via Firebase (Google SSO).** The dashboard signs users in
  with Firebase Auth's Google provider; `apps/api` verifies the resulting ID
  token server-side on every request (`apps/api/src/firebaseAuth.ts`,
  `firebase-admin`) — no shared secret needed for verification, just the
  Firebase project id (public config). Adding another SSO provider (Entra
  ID, a SAML/OIDC IdP) is a Firebase console change plus one more sign-in
  button, not a backend change: the API only ever sees a verified token,
  never which provider issued it. What's still missing is the Gmail/Outlook
  *mail* OAuth consent flow (spec section 9 — that needs its own provider
  app registration and review, separate from user login).
- **Structured logging + a security audit trail.** Every process logs JSON
  to stdout via `packages/logger` (point any collector — CloudWatch, GCP
  Logging, Datadog, Better Stack — at stdout, no code change needed).
  Credentials, tokens, and passwords are redacted wherever they'd appear in
  a log line. Distinct from that: an `auditLog()` call records
  security-relevant events (failed auth, denied cross-tenant access,
  account connected, rule changed, run triggered/completed) as
  `{"audit": true, ...}` lines — the trail a SOC2-style review actually asks
  for, separate from the product's own `run_actions` log of what a rule did
  to a user's mail.
- **Secrets work without a cloud secrets manager.** `packages/config`
  reads a secret from a plain env var or, preferably on a VPS/Docker host,
  from a file via the `<NAME>_FILE` convention (Docker/Compose secrets) —
  same code path either way, and a missing secret fails fast with an
  actionable error instead of a confusing crash three calls deep.

## Getting started

```
pnpm install
pnpm --filter @inboxrulz/rules-engine test   # pure logic, no setup needed
pnpm -r test                                  # every package/app
```

### One-time Firebase setup (for real sign-in)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (or use an existing one).
2. Authentication -> Sign-in method -> enable **Google**.
3. Project settings -> General -> Your apps -> add a **Web app** — copy its
   `apiKey`, `authDomain`, `projectId`, `appId` into `apps/web/.env.local`
   (see `apps/web/.env.example`). These are public client config, not secrets.
4. Put the same `projectId` in `apps/api/.env` as `FIREBASE_PROJECT_ID`
   (see `apps/api/.env.example`). No service-account key is needed —
   verifying an ID token only checks its signature against Google's own
   public keys plus this project id.

### Run everything

```
# terminal 1 — api
cp apps/api/.env.example apps/api/.env   # fill in FIREBASE_PROJECT_ID
CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32) pnpm --filter @inboxrulz/api start

# terminal 2 — dashboard
cp apps/web/.env.example apps/web/.env.local   # fill in the Firebase web config
pnpm --filter @inboxrulz/web build && pnpm --filter @inboxrulz/web start
```

Both processes default to an in-memory store, so state resets on restart
and isn't shared between them — fine for poking at the UI, not for anything
persistent (see "Design choices" above).

The worker runs the same pipeline on a daily cron (`apps/worker`, default
6am; override with `CRON_SCHEDULE`) — start it with
`pnpm --filter @inboxrulz/worker start`. Set `ANTHROPIC_API_KEY` for real
rescue-rule judgment; without it, the worker logs a warning and falls back
to the conservative heuristic classifier. `CREDENTIALS_ENCRYPTION_KEY` must
be the same value as the API's.

On a VPS or self-managed Docker host with no cloud secrets manager, prefer
mounting secrets as files and pointing `<NAME>_FILE` at them (Docker/Compose
secrets convention) over plain env vars — see `packages/config`.

## What's not here yet

- A Postgres-backed `Repository` shared by `apps/api` and `apps/worker`
- Outlook/365 and IMAP `MailConnector` adapters
- The Gmail/Outlook *mail* OAuth consent flow (separate from the Firebase
  user-login flow, which is now real) — needed once "connect an inbox" does
  more than accept an already-obtained token set
- The V2 feature set (custom rule builder, notifications, undo window,
  cross-account view — spec section 5)
