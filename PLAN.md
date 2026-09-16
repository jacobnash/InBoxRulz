# InboxRules — Remediation Plan

Companion to `AUDIT.md` — read that first for the evidence behind every item here. This plan is staged so the build stays green at every commit; nothing here requires a big-bang rewrite, and every structural item lists its own rollback.

## Executive summary — priority order

1. **Bump `next` to `>=15.5.24`** — two critical, currently-unpatched RCE CVEs. Do this first, independent of everything else below.
2. **Fix the root `test`/`build` scripts** — before wiring up CI on top of them.
3. **Add characterization tests to the three 0%-covered files** (`connectorFactory.ts`, `rescueClassifier.ts`, `firebaseAuth.ts`) — before the Stage 2 refactor that moves two of them.
4. **Extract orchestration out of `apps/worker` into a shared package** — removes the app-depends-on-app coupling and the duplicated classifier-wiring code in one move.
5. **Stand up CI** on the corrected scripts, with thresholds that ratchet up, not a wall that blocks day-one.

---

## Stage 0 — Safety net

The codebase already has decent coverage on the two files Stage 2 will restructure (`runner.ts` 100%, `scheduler.ts` 76.31%), so the main safety-net gap is the three 0%-covered files that Stage 2's extraction touches. **Stage 0 is therefore folded into Stage 1, items 3-5 below** — those tests must land and pass before Stage 2, item 1 (the orchestrator extraction) starts. This is called out explicitly rather than given its own empty section, per the audit's own finding: there's no untested-and-about-to-be-refactored code that isn't already covered by a Stage 1 item.

One baseline metric worth recording now, before any change, so improvement is measurable later (Phase 1 numbers from `AUDIT.md`, restated as the t=0 baseline):

| Metric | Baseline (this audit) |
|---|---|
| `pnpm audit --prod` critical / high | 2 / 16 |
| Statement coverage — api / worker | 70.93% / 49.8% |
| jscpd duplicated lines | 3.11% |
| Functions over complexity 10 | 3 (max 15) |
| Functions over 60 lines | 3 (max 186) |
| Root `pnpm test` actually runs | 5 of 9 packages |

---

## Stage 1 — Low-risk, high-leverage

### 1.1 — Upgrade `next` past the patched CVE line
- **Rationale:** [S1](AUDIT.md#s1-nextjs-carries-unpatched-critical-rce-cves).
- **Files touched:** `apps/web/package.json` (`next` `^14.2.15` → `^15.5.24`), `pnpm-lock.yaml`.
- **Migration:** `pnpm --filter @inboxrulz/web add next@^15.5.24`, then `pnpm --filter @inboxrulz/web build` and manually re-run the existing Playwright smoke pass (connect an account, toggle a rule, run now, sign-in gate) since there's no automated e2e test for the web app yet. Watch specifically for App Router / `next/navigation` behavior changes (`useParams` is used in `[id]/page.tsx`).
- **Acceptance criteria:** `pnpm audit --prod` reports 0 critical/high advisories against `next`; `pnpm --filter @inboxrulz/web build` succeeds; manual smoke pass reproduces the same behavior as before the bump.
- **Test strategy:** manual (no e2e suite exists — see 1.9 for adding one).
- **Size:** M. **Dependencies:** none — do first. **Risk:** low-medium (major version bump of a UI framework with only 3 components using it; App Router usage here is minimal and vanilla).

### 1.2 — Fix root `test`/`build` scripts
- **Rationale:** [A1](AUDIT.md#a1-root-scripts-silently-exclude-appsdagger).
- **Files touched:** `package.json` (root), lines 10-11.
- **Migration:** change `"build": "pnpm -r --filter=./packages/* build"` → `"build": "pnpm -r build"`, same for `"test"`. Run `pnpm build` and `pnpm test` once at the root to confirm all 9 workspaces execute (`apps/web` has no `build`/`test` script mismatch to worry about — Next's `build` script already exists there).
- **Acceptance criteria:** `pnpm test` at the root runs and reports all 94 existing tests (7 packages + 2 apps with tests); `pnpm build` builds all 5 buildable packages plus `apps/web`'s Next build (note: `apps/api`/`apps/worker` have a `build` script too — `tsc -p tsconfig.json` — confirm it's included and passes).
- **Test strategy:** the fix *is* the test — running the corrected script is the acceptance check.
- **Size:** S. **Dependencies:** none. **Risk:** none (this only makes existing checks run, doesn't change what they check).

### 1.3 — Characterization tests: `apps/worker/src/connectorFactory.ts`
- **Rationale:** [C1](AUDIT.md#c1-coverage-gap-is-concentrated-on-the-riskiest-code). Also unblocks Stage 2.1 (this file moves).
- **Files touched:** new `apps/worker/test/connectorFactory.test.ts`. No production code changes.
- **Test strategy:** mirror the mocking pattern already proven in `packages/mail-connector/test/GmailConnector.test.ts` — construct a fake `ConnectedAccountRecord` with `encryptCredentials(JSON.stringify({...}), testKey)` as its `encryptedCredentials`, call `createConnectorForAccount(account, testKey)`, and assert it returns a `GmailConnector` instance (or, more usefully, that the `OAuth2Client` it builds got the right `access_token`/`refresh_token` — may need to expose these for assertion, or assert indirectly via a subsequent mocked API call). Cover: gmail success path, and the `outlook`/`icloud`/`fastmail`/`zoho`/`imap` branches all throwing the documented "not implemented" error.
- **Acceptance criteria:** `connectorFactory.ts` statement coverage moves from 0% to >90%.
- **Size:** S. **Dependencies:** none. **Risk:** none — additive only.

### 1.4 — Characterization tests: `apps/worker/src/rescueClassifier.ts`
- **Rationale:** [C1](AUDIT.md#c1-coverage-gap-is-concentrated-on-the-riskiest-code).
- **Files touched:** new `apps/worker/test/rescueClassifier.test.ts`. No production code changes (both `heuristicRescueClassifier` and `createAnthropicRescueClassifier` are already exported and independently callable — no refactor needed to make this testable).
- **Test strategy:** `heuristicRescueClassifier` — direct unit tests (reply/forward subject → important, everything else → not important; already trivial, no mocking needed). `createAnthropicRescueClassifier` — mock `@anthropic-ai/sdk`'s `Anthropic` class (`vi.mock("@anthropic-ai/sdk")`) to return a controlled `messages.create()` response, and specifically exercise `parseResponse()`'s three paths: well-formed JSON, malformed/non-JSON text, and a JSON object missing the expected shape (`{important: "yes"}` instead of a boolean) — the safety-net fallback path this audit flagged as never having been exercised.
- **Acceptance criteria:** `rescueClassifier.ts` statement coverage moves from 0% to >90%; the malformed-response fallback path is explicitly asserted (`{important: false, reason: "..."}`, not a throw).
- **Size:** S. **Dependencies:** none. **Risk:** none.

### 1.5 — Characterization tests: `apps/api/src/firebaseAuth.ts` + the two untested API paths
- **Rationale:** [C1](AUDIT.md#c1-coverage-gap-is-concentrated-on-the-riskiest-code).
- **Files touched:** new `apps/api/test/firebaseAuth.test.ts`; additions to `apps/api/test/server.test.ts` for the two uncovered branches (the `POST /accounts/:id/run` failure path, `GET /accounts/:id/runs/:runId/actions`).
- **Test strategy:** mock `firebase-admin/app` and `firebase-admin/auth` (`vi.mock`) to avoid any real network/credential dependency, verify `createFirebaseIdTokenVerifier` calls `verifyIdToken` with the right token and maps the decoded result to `{uid, email}`, and verify the `getFirebaseApp()` singleton is only initialized once across repeated calls (`getApps()`/`initializeApp` call counts). For `server.test.ts`: make `runAccountNow` throw in the existing `MockConnector`-based test setup (same pattern already used in `apps/worker/test/runner.test.ts`'s "marks the run 'partial'" test) to exercise the 502 path; add a straightforward test for the actions-list route using an existing run/action fixture.
- **Acceptance criteria:** `firebaseAuth.ts` coverage >90%; `server.ts` branch coverage rises from 58.06% to >85%; no route in `apps/api` has zero test coverage.
- **Size:** S. **Dependencies:** none. **Risk:** none.

### 1.6 — Make coverage measurement permanent
- **Rationale:** enables tracking Stage 1.3-1.5's improvement and prevents regression; formalizes the ad-hoc tooling used for this audit.
- **Files touched:** `packages/*/package.json` and `apps/{api,worker}/package.json` (add `@vitest/coverage-v8` as a devDependency — can be hoisted to the workspace root instead if preferred, both work with pnpm), a new `"coverage": "vitest run --coverage"` script alongside each existing `"test"` script, root `package.json`'s own script list.
- **Acceptance criteria:** `pnpm -r coverage` runs and produces a report for every package; numbers match this audit's baseline table.
- **Size:** S. **Dependencies:** none. **Risk:** none.

### 1.7 — Add a real ESLint config (currently `pnpm lint` no-ops)
- **Rationale:** Phase 0 finding — `"lint"` is defined at the root but no config exists for any package to run against, so it silently does nothing today.
- **Files touched:** new root `eslint.config.mjs` (flat config, ESLint 9), `packages/*/package.json` + `apps/*/package.json` add a `"lint": "eslint ."` script, root devDependencies (`eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`; `apps/web` additionally wants `eslint-config-next` or `eslint-plugin-react-hooks` since it currently has an inline `// eslint-disable-next-line react-hooks/exhaustive-deps` referencing a rule that isn't wired up to anything).
- **Migration:** start with the same rule set proved out during this audit (`complexity: warn@10`, `max-lines-per-function: warn@60`, `max-depth`, `max-params`) plus standard `@typescript-eslint/recommended`, all as **warnings**, not errors, so this lands without blocking anyone — see Guardrails below for the ratchet-to-error plan.
- **Acceptance criteria:** `pnpm -r lint` actually lints every package and produces the same 7 warnings this audit's ephemeral config found (confirms parity); zero new errors introduced by adding the config itself.
- **Size:** S. **Dependencies:** none. **Risk:** low (warnings-only, can't break a build).

### 1.8 — Add a timeout to outbound Gmail API calls
- **Rationale:** [D2](AUDIT.md#d2-no-timeoutretrybackoff-on-outbound-gmail-calls).
- **Files touched:** `packages/mail-connector/src/gmail/GmailConnector.ts` (constructor / `google.gmail({...})` call).
- **Migration:** pass `timeout` (e.g. 30s) via the `googleapis` client's built-in request options; confirm a timeout/429 surfaces as a normal `Error` (it does, by default, in `googleapis`) so `apps/worker/src/runner.ts`'s existing per-rule try/catch handles it without any change there.
- **Acceptance criteria:** existing `GmailConnector.test.ts` suite still passes unmodified (timeout is a client-construction option, not a behavior change to any tested code path); add one new test asserting the client is constructed with the expected timeout option.
- **Size:** S. **Dependencies:** none. **Risk:** low — purely additive configuration.

### 1.9 — Dedupe the web sign-in gate
- **Rationale:** [D3](AUDIT.md#d3-duplicated-sign-in-gate-across-both-pages).
- **Files touched:** new `apps/web/components/RequireAuth.tsx`; `apps/web/app/page.tsx` and `apps/web/app/accounts/[id]/page.tsx` (replace the inline gate with the shared component).
- **Acceptance criteria:** both pages render identically to before (manual check — no unit tests exist for these components today, see 3.3); the duplicated JSX block no longer appears in `jscpd`'s output on a re-run.
- **Size:** S. **Dependencies:** none. **Risk:** low.

---

## Stage 2 — Structural

### 2.1 — Extract orchestration out of `apps/worker` into `packages/orchestrator`
- **Rationale:** [B1](AUDIT.md#b1-apps-depending-on-apps).
- **Current state:** `apps/api` imports `runAccountNow`, `createConnectorForAccount`, `createAnthropicRescueClassifier`, `heuristicRescueClassifier` from `@inboxrulz/worker`. `apps/worker/src/main.ts` and `apps/api/src/main.ts` each independently re-derive the classifier-selection logic.
- **Target state:** a new `packages/orchestrator` exports `runOnce`, `runAllActiveAccounts`, `runAccountNow`, `createConnectorForAccount`, `createAnthropicRescueClassifier`, `heuristicRescueClassifier`, and a new `createDefaultClassifier(logger)` helper that wraps the duplicated selection logic once. `apps/worker` depends on `packages/orchestrator` and additionally owns `scheduler.ts` (the cron-specific `scheduleDailyRuns` wrapper) and its own `main.ts`. `apps/api` depends on `packages/orchestrator` directly — no more `apps/api → apps/worker` edge.
- **Migration steps (build stays green at every commit):**
  1. Create `packages/orchestrator` with `package.json`/`tsconfig.json` matching the existing package template.
  2. Move `runner.ts` and its exports into `packages/orchestrator/src/runner.ts` verbatim (no logic changes) — run `apps/worker`'s existing test suite against the new location (move the tests too) to confirm zero behavior change.
  3. Move `connectorFactory.ts` and `rescueClassifier.ts` into `packages/orchestrator/src/` verbatim, moving their Stage 1.3/1.4 tests with them.
  4. Add `createDefaultClassifier(logger): RescueClassifier` to the new package, replacing the duplicated block in both `main.ts` files with a single call.
  5. Update `apps/worker/package.json` and `apps/api/package.json`: remove the `@inboxrulz/worker` dependency edge from `api`, add `@inboxrulz/orchestrator` to both.
  6. Update all import paths (`apps/worker/src/main.ts`, `apps/worker/src/scheduler.ts`, `apps/api/src/main.ts`, `apps/api/src/server.ts`).
  7. Run `pnpm -r test && pnpm -r typecheck` — this should be a pure move, so nothing should change in test count or pass/fail status.
- **Acceptance criteria:** `apps/api`'s `package.json` no longer lists `@inboxrulz/worker`; the `api → worker` edge disappears from the dependency graph (re-run the Phase 1 coupling check to confirm); all 94+ existing tests pass unmoved in behavior, just relocated; the duplicated classifier-selection block is gone from both `main.ts` files (confirm via a `jscpd` re-run).
- **Size:** M. **Dependencies:** Stage 1.3 and 1.4 (characterization tests for the two files being moved) must land first. **Risk:** medium — touches every entrypoint's wiring, but it's a mechanical move with tests carried along at each step; rollback is `git revert` of the single PR, since no external interface (API routes, worker's cron behavior) changes.

### 2.2 — Split `buildServer` and remove the auth+ownership duplication
- **Rationale:** [B2](AUDIT.md#b2-two-god-functions-buildserver-and-accountpage), [B3](AUDIT.md#b3-repeated-authownership-preamble-in-every-route).
- **Current state:** one 156-line function; the auth+ownership preamble hand-copied into 5 route handlers.
- **Target state:** a `preHandler` hook (or Fastify `decorateRequest`) that performs `authenticate` + `loadOwnedAccount` once per request where an `:id` param is present, attaching `request.user`/`request.account`; route registration split into `routes/accounts.ts`, `routes/rules.ts`, `routes/runs.ts`, each a small `FastifyPluginAsync` registered from a slimmed-down `buildServer`.
- **Migration steps:**
  1. Add the `preHandler` alongside the existing `authenticate`/`loadOwnedAccount` helpers (additive — nothing calls it yet).
  2. Convert routes one at a time to use it, starting with the single-route files with the least test surface (`GET /accounts/:id/runs/:runId/actions`, just added a test for in 1.5) — run the full `server.test.ts` suite after each route's conversion.
  3. Once all routes use the hook, extract route groups into separate plugin files; `buildServer` becomes composition only.
- **Acceptance criteria:** `buildServer`'s own body drops under 60 lines (matching the ESLint threshold used elsewhere); all existing `server.test.ts` tests pass with zero test-code changes required (the hook is an internal refactor, the HTTP contract is unchanged); a `jscpd` re-run shows the 5-way duplication is gone.
- **Size:** M. **Dependencies:** none (independent of 2.1). **Risk:** low — Fastify's `preHandler`/plugin system is designed for exactly this, and the existing black-box HTTP tests (via `.inject()`) validate behavior without caring about internal structure.

### 2.3 — Decompose `AccountPage`
- **Rationale:** [D1](AUDIT.md#d1-account-page-is-a-god-component).
- **Current state:** one 201-line component owning fetch, 4 mutation handlers, and 3 visually distinct sections' JSX.
- **Target state:** `RuleList`, `RunLog`, `RunActionsTable` as separate components taking props; `AccountPage` owns data-fetching/state and composes the three.
- **Migration steps:** extract one section at a time (`RunActionsTable` first — smallest, only reads props, no handlers of its own), manually verify in the browser after each extraction (no component-level tests exist yet — see 3.3), then `RuleList`, then `RunLog`.
- **Acceptance criteria:** `AccountPage`'s own function body drops under 60 lines; manual smoke pass (same flow as 1.1's) behaves identically.
- **Size:** M. **Dependencies:** none. **Risk:** low — pure extraction, no state-management changes, and the existing Playwright smoke script from the original build session can be re-run as a manual regression check.

---

## Stage 3 — Longer-horizon (needs a product/design decision, not a unilateral refactor)

These aren't quality defects in the way Stages 1-2 are — they're places where the *right* answer depends on a decision this plan shouldn't make unilaterally.

### 3.1 — Shared, persistent `Repository` (Postgres) behind the existing port
- **Already flagged in `README.md`**, not new to this audit. Two real options once it's prioritized:
  - **(a) Prisma-backed `Repository`** implementing the interface in `packages/db/src/repository.ts` against the existing `prisma/schema.prisma` — smallest conceptual leap since the schema already exists and was written for this.
  - **(b) A lighter query builder (Kysely/Drizzle)** if Prisma's runtime/cold-start cost becomes a concern at the worker's deploy target — more setup work now, less abstraction overhead later.
  - Either way, the `Repository` interface itself (already proven by `InMemoryRepository`) shouldn't need to change — this is purely a new adapter.

### 3.2 — Real queue instead of a direct in-process call
- Once 2.1 lands, `apps/api` and `apps/worker` both depend on `packages/orchestrator` rather than on each other, which is what makes this tractable later: replacing `runAccountNow`'s direct call with "enqueue a job, `apps/worker` consumes it" becomes a change inside `apps/api`'s route handler and `apps/worker`'s consumer loop, not a dependency-graph change. Options: BullMQ+Redis (matches the spec's original architecture diagram most literally), or a managed queue (SQS, Cloud Tasks) if avoiding a new stateful service to run is a priority. No action needed until the product needs real concurrency/retry semantics for runs — today's synchronous call is fine for both current usage.

### 3.3 — A test strategy for `apps/web`
- Today `apps/web` has zero automated tests (component or e2e) — everything was verified manually via Playwright during the original build session, which doesn't run in CI. Options: React Testing Library for component-level tests (fast, but the pages are thin enough that this test more render logic than business logic), or a small Playwright e2e suite covering the sign-in-gate → connect-account → toggle-rule → run-now flow (slower, but matches how this app was actually manually validated and would catch the class of bug a component test wouldn't). Recommend starting with 2-3 Playwright scenarios covering the flow already proven manually, since that's the highest-value, lowest-redundancy option — but this is a call worth making with whoever owns the frontend, not unilaterally.

### 3.4 — Mutation testing
- Not run in this audit (out of the tooling scope agreed for this pass). Worth revisiting once Stage 1's coverage work lands and coverage numbers are consistently high — mutation testing (Stryker) is most useful for asking "is this coverage actually asserting the right things," which is a question worth asking after coverage exists, not before.

---

## Guardrails

- **CI workflow** (new `.github/workflows/ci.yml`): on every PR, run `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm -r build` — using the corrected root scripts from 1.2, so this workflow is trustworthy the day it's added rather than inheriting the gap it exists to prevent.
- **Coverage floor that ratchets, not blocks:** once 1.3-1.6 land, set each package's vitest coverage threshold (`test.coverage.thresholds` in `vitest.config`) to slightly below its current number (e.g., current − 2%), so CI fails on regression but never blocks unrelated work, and raise the floor each time a package's real coverage improves. Do not set a single repo-wide floor — `apps/worker` and `apps/api` starting near 50-70% and `packages/rules-engine` already at 96% need different floors, or the floor is either too loose to matter or blocks unrelated PRs to the well-tested packages.
- **Complexity ceiling in CI, not just local lint:** promote `complexity`, `max-lines-per-function` from `warn` to `error` in `eslint.config.mjs` (1.7) once the 3 existing violations are either fixed (2.2, 2.3) or explicitly annotated with an inline `eslint-disable` + comment explaining why (the `MockConnector.matches()` case from this audit, which this plan does not recommend changing).
- **Import-boundary lint rule:** add `eslint-plugin-import`'s `no-restricted-paths` (or the simpler `import/no-internal-modules` if the boundary is just "apps can't import other apps") once 2.1 lands, so the `apps/api → apps/worker` coupling this audit found can't silently reappear.
- **Clone detection in CI:** `jscpd` as a CI step with a threshold just above the current 3.11% (e.g., 5%), so new duplication is caught before merge rather than accumulating to the point a future audit has to re-discover it.
- **Dependency audit in CI:** `pnpm audit --prod` as a required check, initially allowed to have known-and-tracked moderate/low findings but failing on any *new* critical/high advisory — don't block merge on the full 50-finding backlog on day one, but stop it from growing.
- **ADRs worth writing**, once each decision is made: "Why `packages/orchestrator` instead of inlining orchestration in `apps/worker`" (2.1), "Postgres via Prisma vs. a query builder" (3.1), "Direct call vs. queue for run triggering" (3.2) — each is exactly the kind of decision that looks arbitrary to a future contributor without the tradeoffs written down.

## Metrics to track, and what success looks like

| Metric | Baseline | 30-day target | 90-day target |
|---|---|---|---|
| `pnpm audit --prod` critical/high | 2 / 16 | 0 / ≤2 (next fixed; fastify/undici tracked) | 0 / 0 |
| Root `pnpm test` covers all workspaces | No (5/9) | Yes (9/9) | Yes, in CI |
| Statement coverage — `apps/api` | 70.93% | >85% | >90% |
| Statement coverage — `apps/worker` | 49.8% | >85% | >90% |
| `apps/api` depends on `apps/worker` | Yes | No | No |
| jscpd duplicated lines | 3.11% | <2.5% | <2% |
| Functions over 60 lines | 3 | 1 (D1 pending) | 0 |
| CI exists and is green | No | Yes | Yes, with ratcheted coverage floors |

**30 days:** Stage 1 fully landed, Stage 2.1 (orchestrator extraction) done, CI running on the corrected scripts with initial (loose) thresholds.
**90 days:** Stage 2 complete, guardrails all active and ratcheted at least once, Stage 3 decisions made (even if the implementation work is still in flight) with ADRs recording why.
