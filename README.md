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
apps/
  worker/          Run orchestrator + daily scheduler + rescue classifiers
  api/             REST API (Fastify): connect accounts, rule CRUD, run log
  web/             Dashboard (Next.js): inbox list, rule toggles, run log
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
- **Auth is a placeholder.** `apps/api` identifies callers via an
  `x-user-id` header (see `apps/api/src/auth.ts`). Real session/JWT auth and
  the Gmail/Outlook OAuth consent flows (spec section 9 — these need
  provider app registration and review) are the other major piece not yet
  built.

## Getting started

```
pnpm install
pnpm --filter @inboxrulz/rules-engine test   # pure logic, no setup needed
pnpm -r test                                  # every package/app
```

Run the API and dashboard together:

```
# terminal 1
CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32) pnpm --filter @inboxrulz/api start

# terminal 2
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm --filter @inboxrulz/web build && pnpm --filter @inboxrulz/web start
```

Both processes default to an in-memory store, so state resets on restart
and isn't shared between them — fine for poking at the UI, not for anything
persistent (see "Design choices" above).

The worker runs the same pipeline on a daily cron (`apps/worker`, default
6am; override with `CRON_SCHEDULE`) — start it with
`pnpm --filter @inboxrulz/worker start`. Set `ANTHROPIC_API_KEY` for real
rescue-rule judgment; without it, the worker logs a warning and falls back
to the conservative heuristic classifier.

## What's not here yet

- A Postgres-backed `Repository` shared by `apps/api` and `apps/worker`
- Outlook/365 and IMAP `MailConnector` adapters
- Real user auth + OAuth consent flows for Gmail/Outlook
- The V2 feature set (custom rule builder, notifications, undo window,
  cross-account view — spec section 5)
