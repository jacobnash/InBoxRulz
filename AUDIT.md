# InboxRules — Architecture & Code Quality Audit

**Audited commit:** `b8e5a82` on `claude/inboxrules-spec-wp4cq6` (2 commits, ~1 day of history)
**Scope:** whole monorepo — `packages/{rules-engine,mail-connector,db,config,logger}`, `apps/{worker,api,web}`
**Method:** real tooling wherever it exists (madge, jscpd, ts-prune, ESLint complexity rules, vitest/v8 coverage, `pnpm audit`), manual read-through for principle-level findings not covered by tooling. Every claim below cites a file, and a line range or tool output.

A calibration note up front: this is a ~4,000-line, one-day-old codebase with no CI, no ADRs, and three commits of history. Several sections of a standard audit template (git-churn-vs-complexity correlation, mutation testing, CI-gate tuning) have no real signal at this age — those sections say so explicitly below instead of manufacturing findings to fill space.

## Executive summary — the five things that matter most

1. **Critical, real, and already present: `next@14.2.35` carries two unauthenticated-RCE CVEs** and 14 more high-severity advisories, and there is no patched release in the 14.x line — the fix requires a major-version upgrade (14 → 15.5.24+), not a patch bump. See [Finding S1](#s1-nextjs-carries-unpatched-critical-rce-cves).
2. **The root `pnpm test` and `pnpm build` scripts silently skip every app** — `apps/worker`, `apps/api`, `apps/web` never run under the documented top-level commands, only under `pnpm -r`. This is exactly the kind of gap that looks fine today and produces a false-green CI the day someone wires one up naively. See [Finding A1](#a1-root-scripts-silently-exclude-appsdagger).
3. **`apps/api` imports directly from `apps/worker`** (`runAccountNow`, `createConnectorForAccount`, the classifier factories) — an app depending on a sibling app as if it were a library. It's also the direct cause of a 7-line block of genuinely duplicated classifier-selection logic in both entrypoints. See [Finding B1](#b1-apps-depending-on-apps).
4. **Test coverage is not evenly missing — it's concentrated exactly where the risk is.** `connectorFactory.ts` (credential decryption) and `rescueClassifier.ts` (LLM prompt/response handling) in `apps/worker`, and `firebaseAuth.ts` (token verification) in `apps/api`, all measure **0% coverage** by v8. See [Finding C1](#c1-coverage-gap-is-concentrated-on-the-riskiest-code).
5. **What's already good, and should be left alone:** the core domain package (`packages/rules-engine`) has zero circular dependencies, zero dependencies on any other internal package, 95.85% statement coverage, and every function under the complexity threshold. The ports-and-adapters split (`Repository`, `MailConnector` interfaces with swappable implementations) is real, not aspirational — `InMemoryRepository` and `MockConnector` are fully working, not stubs. This is the one part of the audit where the honest finding is "don't touch it."

---

## Phase 0 — Ground truth

### Intended architecture (from `README.md` and `docs/spec.md`)

The spec (`docs/spec.md`) describes a multi-tenant SaaS: users connect mailboxes (Gmail/Outlook/IMAP), five rule types act on their mail (four deterministic, one LLM-judgment), a worker runs them on a schedule or on demand, and a dashboard shows what happened. The architecture diagram (spec §6) draws four boxes — Dashboard, API/Auth, Scheduler/Queue (worker), Rules Engine, Mail connector layer — backed by one Postgres database, with the API "enqueuing" work for the worker rather than calling it directly.

`README.md`'s "Design choices worth knowing about" section is itself a partial gap list, written by the same effort that built the code — it already discloses: no Postgres-backed `Repository` yet (in-memory only, one per process), only Gmail is wired up (no Outlook/IMAP), and no mail-provider OAuth consent flow. This audit doesn't re-litigate those — they're documented, intentional, and out of scope for "did we build what we said" versus "is what we built well-structured."

### Actual structure

```
packages/
  rules-engine/    pure functions, 5 rule types, zod config schemas         (714 LOC incl. tests)
  mail-connector/  MailConnector interface, GmailConnector, MockConnector   (697 LOC)
  db/              domain types, Repository port, InMemoryRepository       (478 LOC)
  config/          secret loading (env var or Docker-secrets-file)          (94 LOC)
  logger/          pino structured logging + audit trail                   (182 LOC)
apps/
  worker/          run orchestrator, cron scheduler, rescue classifiers    (648 LOC)
  api/             Fastify REST API, Firebase auth, audit logging          (607 LOC)
  web/             Next.js dashboard, Firebase client auth                 (618 LOC)
```
Total: 62 source/test files, ~4,038 lines (`find` + `wc -l`, this session).

Entry points: `apps/api/src/main.ts` (Fastify HTTP server), `apps/worker/src/main.ts` (node-cron scheduler), `apps/web` (Next.js, static + client components — no server actions). No queue, no message broker; "enqueue" from the spec diagram is currently a direct in-process async function call (`runAccountNow`).

Build/test/CI: pnpm workspaces (9 packages), vitest per package, `tsc --noEmit` per package for typecheck. **No CI configuration exists** (`.github/` is absent). No lint config exists at all — `pnpm lint` is defined in the root `package.json` but there is no ESLint/other config for it to run, so `pnpm -r lint` currently no-ops rather than failing (each package has no `lint` script of its own, so pnpm reports "no such script" per package, which pnpm treats as non-fatal).

### Intent vs. reality — the gap list

| Area | Spec says | Reality | Already disclosed in README? |
|---|---|---|---|
| Persistence | One shared Postgres DB | Two separate in-memory stores (api's and worker's don't share state) | Yes |
| API → Worker | API enqueues a job; a separate worker process consumes it | API imports and calls the worker's orchestration function directly, in-process | **No** — this is new information from this audit ([B1](#b1-apps-depending-on-apps)) |
| Mail providers | Gmail, Outlook, IMAP, iCloud, Fastmail, Zoho | Gmail only | Yes |
| Mail OAuth | Provider-reviewed OAuth consent flow | Dashboard form that pastes a pre-obtained token JSON | Yes |
| Rate limiting | "Per-tenant backoff in the worker" (spec §9) | No timeout, retry, or backoff on any Gmail API call | **No** — new from this audit ([D2](#d2-no-timeoutretrybackoff-on-outbound-gmail-calls)) |
| CI / lint | Not specified, but implied by "build/test/CI setup" being part of a real repo | Neither exists | **No** — new from this audit ([A1](#a1-root-scripts-silently-exclude-appsdagger)) |

Everything else in the spec's own "what's not here yet" list is accurate and doesn't need re-discovering.

### Ecosystem and idioms

TypeScript (strict mode, `NodeNext` modules) throughout; Fastify + zod on the API; Next.js App Router + Firebase client SDK on the web app; vitest for tests everywhere; functional style in the domain layer (pure functions returning plain data, no classes), light OO only at I/O adapter boundaries (`GmailConnector`, `MockConnector`, `InMemoryRepository` — one interface, swappable implementations). Findings below are judged against these idioms — e.g., the lack of an OO domain model is not flagged, because nothing here calls for one.

---

## Phase 1 — Measurements

### Complexity — ESLint `complexity`/`max-lines-per-function`/`max-depth`/`max-params` rules (threshold 10/60/4/4), run across all non-test `.ts`/`.tsx`

Tool: `eslint@9.39.5` + `@typescript-eslint/parser@8`, ephemeral flat config, run against every `src`/`app`/`lib`/`components` file in the repo.

**7 warnings total, 0 above the "flag at 20" bar:**

| File:line | Finding | Value |
|---|---|---|
| `packages/mail-connector/src/mock/MockConnector.ts:66` | `matches()` cyclomatic complexity | 15 |
| `packages/mail-connector/src/mock/MockConnector.ts:35` | `applyAction()` cyclomatic complexity | 11 |
| `packages/mail-connector/src/gmail/normalize.ts:42` | `normalizeGmailThread()` cyclomatic complexity | 11 |
| `apps/api/src/server.ts:67` | `buildServer()` function length | 137 lines (max 60) |
| `apps/web/app/accounts/[id]/page.tsx:55` | `AccountPage()` function length | 186 lines (max 60) |
| `apps/web/app/page.tsx:9` | `HomePage()` function length | 100 lines (max 60) |

No function anywhere exceeds complexity 15; nothing approaches the "flag above ~20" threshold the audit brief sets. `MockConnector.matches()` at 15 is the numeric outlier, but it's a flat sequence of independent early-return guard clauses (one per `MailQuery` field) with **zero nesting** — cyclomatic complexity overstates its actual cognitive load, which is low; this is exactly the "cyclomatic vs. cognitive complexity" distinction the audit brief itself calls out. No action warranted there. The two function-length findings (`buildServer`, `AccountPage`) are real and are covered under [Finding B2](#b2-two-god-functions-buildserver-and-accountpage) and [D1](#d1-account-page-is-a-god-component).

### Coupling — inter-package dependency graph (manual, from each `package.json`'s `dependencies`) + `madge --circular` per package

```
rules-engine  ← (leaf, no @inboxrulz deps)
mail-connector → rules-engine
db            ← (leaf, no @inboxrulz deps)
config        ← (leaf, no @inboxrulz deps)
logger        ← (leaf, no @inboxrulz deps)
worker        → config, db, logger, mail-connector, rules-engine
api           → config, db, logger, mail-connector, rules-engine, worker   ← the finding
web           ← (no @inboxrulz deps — talks to api over HTTP only)
```

`madge --circular` on every package's `src/`: **zero circular dependencies found**, in all 7 packages.

Instability (I = Ce/(Ca+Ce)):

| Package | Ca (depended on by) | Ce (depends on) | I | Reading |
|---|---|---|---|---|
| rules-engine | 3 (mail-connector, worker, api) | 0 | **0.0** | Maximally stable — correct for the domain kernel |
| db | 2 (worker, api) | 0 | **0.0** | Maximally stable — correct, it's a port |
| config | 2 | 0 | 0.0 | Stable leaf utility |
| logger | 2 | 0 | 0.0 | Stable leaf utility |
| mail-connector | 2 (worker, api) | 1 | 0.33 | Reasonable — thin adapter over one dependency |
| worker | 1 (api) | 5 | 0.83 | Unstable, as expected for orchestration code — **except it's depended on by a same-layer app, not just a leaf; see B1** |
| api | 0 | 6 | 1.0 | Maximally unstable — correct for a top-level entrypoint |

Abstractness read (Martin's A/I plot, applied loosely — no automated tool for this in the TS ecosystem, judged manually): `rules-engine` sits at low abstractness *and* low instability ("zone of pain" by the textbook definition), but this is the expected, healthy shape for a stable domain-logic kernel with a small, deliberately closed set of concrete algorithms — the metric is a heuristic best aimed at service/framework layers, and flagging a domain kernel for being stable-and-concrete would be applying it past its useful range. `db` and `mail-connector` both cleanly separate an abstract interface (`Repository`, `MailConnector`) from concrete implementations, landing them close to the main sequence — this is the intended ports-and-adapters shape and is working.

### Duplication — `jscpd@4`, min 30 tokens, whole repo excluding `node_modules`/`dist`/`.next`/test files

**Overall: 3.11% duplicated lines, 3.13% duplicated tokens across 51 files** — low, healthy. 11 clones found; broken down:

- **6 of 11 are `package.json` clones** (shared `devDependencies`/`scripts` boilerplate across sibling packages) — not real duplication, discount entirely.
- **1 is `db/src/inMemoryRepository.ts:42-47` vs. `db/src/repository.ts:24-29`** — an interface method signature mirrored by its sole implementer's signature. This is required, idiomatic TypeScript, not a DRY violation; deduplicating it (e.g. via some signature-generating helper) would add indirection to save nothing. **Coincidental similarity, not true duplication — leave it.**
- **4 are real** and covered as findings below: [B1](#b1-apps-depending-on-apps) (`api/src/main.ts` vs `worker/src/main.ts`), [B3](#b3-repeated-authownership-preamble-in-every-route) (`api/src/server.ts` internal, ×5 not just the 2 jscpd's token threshold caught), and [D3](#d3-duplicated-sign-in-gate-across-both-pages) (`web/app/page.tsx` vs `web/app/accounts/[id]/page.tsx`).

### Dead exports — `ts-prune`, run per package

Run per-package (each against its own `tsconfig.json`), `ts-prune` flags nearly every export in every `index.ts` as "unused." **This is a known tool limitation, not a real finding**: each package's `index.ts` exists specifically to be consumed by *other* packages, and `ts-prune` run against a single package's own `tsconfig.json` has no visibility into cross-package usage in a workspace without TS project references (which this repo doesn't have configured). Running it against a unified project-references build would be needed to get a real dead-export signal; that's a tooling gap worth closing (folded into the guardrails in `PLAN.md`), not a code defect. **No dead-export findings are reported from this pass** — the raw list would be almost 100% false positives.

### Coverage — `@vitest/coverage-v8`, per package, `text-summary` + `text` reporters

(Installed as a temporary dev dependency for this measurement, then reverted — see `PLAN.md` Stage 1 for making this permanent.)

| Package | Statements | Branches | Functions |
|---|---|---|---|
| rules-engine | 95.85% | 89.83% | 90.9% |
| config | 95.83% | 80% | 66.66% |
| logger | 93.1% | 66.66% | 66.66% |
| mail-connector | 89.95% | 81.08% | 91.3% |
| db | 77.97% | 87.87% | 80.95% |
| **api** | **70.93%** | **60%** | **57.14%** |
| **worker** | **49.8%** | 84.84% | **44.44%** |

Per-file breakdown for the two low scorers (`vitest --coverage` `text` reporter):

**`apps/worker`:**
```
connectorFactory.ts   0%   (1-50 uncovered — entire file)
rescueClassifier.ts   0%   (1-94 uncovered — entire file)
main.ts               0%   (entrypoint, expected)
runner.ts           100%
scheduler.ts        76.31% (54-62 uncovered: scheduleDailyRuns's cron.schedule() registration itself)
```

**`apps/api`:**
```
firebaseAuth.ts        0%   (1-30 uncovered — entire file)
main.ts                0%   (entrypoint, expected)
server.ts           88.62% statements / 58.06% branches (uncovered: lines 178-187 — the
                     POST /accounts/:id/run failure branch — and 213-218 — the entire
                     GET /accounts/:id/runs/:runId/actions route has no dedicated test)
```

This is [Finding C1](#c1-coverage-gap-is-concentrated-on-the-riskiest-code) — see below for why this specific shape matters.

### Security / dependency hygiene — `pnpm audit --prod`

**50 advisories, 2 critical, 16 high, 24 moderate, 6 low**, against production dependencies only. The critical and high findings cluster into three root causes:

1. **`next@14.2.35`** (resolved via `apps/web`) — 2 critical (unauthenticated RCE, one Windows-hosted-server-specific, one via the AVIF image-optimization path) + 9 of the 16 high advisories (DoS, SSRF, cache poisoning, middleware bypass). Checked `npm view next versions`: **14.2.35 is already the newest 14.x release** — there is no patch-level fix available; every one of these is only resolved at `>=15.5.x`. This is [Finding S1](#s1-nextjs-carries-unpatched-critical-rce-cves).
2. **`fastify@4.x`** (resolved via `apps/api`) — 1 high advisory (Content-Type header tab-character body-validation bypass, fixed at `>=5.7.2`) plus a related high in its `find-my-way` router dependency (HTTP/2 DDoS). Fix requires a Fastify 4→5 major upgrade.
3. **`undici` (transitive via `apps/web` → `firebase` → `@firebase/auth`)** — 4 high + 2 low WebSocket-related advisories, fixed at `undici>=6.27.0`. Worth checking whether a newer `firebase` npm release pulls a patched `undici` without needing a major bump (not verified in this pass — flagged as a to-check item, not a confirmed major-bump requirement, unlike the two above).

`grep` for hardcoded secrets (`api[_-]?key|secret|password|token\s*[:=]\s*['"][a-zA-Z0-9_-]{10,}`) across all source: **zero matches** outside test fixtures and placeholder strings. No secrets in source.

Version-pinning style: every dependency uses `^` caret ranges — standard npm/pnpm convention, not itself a finding. Note for precision: the caret ranges are **not** the cause of the Next.js/Fastify vulnerabilities above — `next@^14.2.15` already resolves to the newest available 14.x patch, and no caret-range update within the pinned major fixes the CVEs. The fix genuinely requires bumping the pinned major version, which is a deliberate, reviewed decision, not a `pnpm update`.

---

## Phase 2 — Themed findings

### <a name="s1-nextjs-carries-unpatched-critical-rce-cves"></a>S1 — Next.js carries unpatched critical RCE CVEs
**Severity: Critical. Effort: M** (major-version bump + regression pass on the 3 pages/components using Next.js APIs).
- **What:** `apps/web/package.json:12` pins `"next": "^14.2.15"`, resolving to `14.2.35`. `pnpm audit --prod` reports 2 critical (unauthenticated RCE) and 9 high advisories against this exact installed version, with fixes only available at `>=15.5.15` through `>=15.5.24` depending on the advisory. No 14.x release fixes any of them.
- **Measurement:** `pnpm audit --prod --json`, cross-checked against `npm view next versions` (confirms 14.2.35 is the newest 14.x).
- **Cost:** this is not a hypothetical — it's a live, disclosed, unauthenticated remote-code-execution class of vulnerability in a dependency already selected for this product. The app isn't deployed publicly yet, which is the only reason this isn't already an active exposure; it will be the moment `apps/web` is deployed to a real host.
- **Fix:** upgrade `next` to `^15.5.24` (or later). This is a major-version bump — App Router and the two page components (`app/page.tsx`, `app/accounts/[id]/page.tsx`) should be smoke-tested afterward, but neither uses any Next 14-specific API removed in 15 (both are plain client components with `useEffect`/`useState`); risk of breakage is low but non-zero.

### <a name="a1-root-scripts-silently-exclude-appsdagger"></a>A1 — Root `test`/`build` scripts silently exclude every `apps/*` package
**Severity: High. Effort: S** (one-line fix).
- **What:** `package.json:10-11` — `"build": "pnpm -r --filter=./packages/* build"` and `"test": "pnpm -r --filter=./packages/* test"` explicitly scope to `packages/*` only. `"lint"` and `"typecheck"` on the next two lines correctly use plain `pnpm -r` (all 9 workspaces). This looks like the `packages/*` filter was added early (when only packages existed) and never widened once `apps/` was created.
- **Measurement:** ran `pnpm build` at the root — it built only `packages/config`, `db`, `logger`, `rules-engine`, `mail-connector` and silently reported success; `apps/worker`, `apps/api`, `apps/web` were never invoked. Same for `pnpm test`: the documented root command never runs the 7 worker tests or the 10 api tests (17 of 94 total tests, 3 of 3 deployable apps).
- **Cost:** this is the one finding in the audit with a real "ticking time bomb" shape. Today it's harmless because every session in this repo's history has manually run `pnpm -r test`. The moment someone (a new contributor, or a CI workflow written by someone who reasonably assumes the root `pnpm test` script is the canonical one) trusts the documented command, `apps/api` and `apps/worker` — the two processes that actually touch user credentials and mail — stop being tested by CI while it stays green.
- **Fix:** change both lines to `pnpm -r build` / `pnpm -r test` (matching `lint`/`typecheck`'s existing pattern). Trivial, but sequence it *before* wiring up any CI (Stage 1, item 1 in `PLAN.md`) — no point building a CI pipeline on top of a script that's already wrong.

### <a name="b1-apps-depending-on-apps"></a>B1 — `apps/api` depends on `apps/worker` as a library
**Severity: Medium. Effort: M.**
- **What:** `apps/api/src/server.ts:13` imports `runAccountNow` from `@inboxrulz/worker`; `apps/api/src/main.ts:4` imports `createConnectorForAccount`, `createAnthropicRescueClassifier`, `heuristicRescueClassifier` from the same package. Per the coupling table above, `apps/worker` has an afferent dependent (`apps/api`) despite being, per the spec's own architecture diagram (§6), a *sibling* deployable process to the API, not something the API should statically depend on.
- **Measurement:** dependency graph (manual, cross-checked with `madge`); the import lines above.
- **Cost, concretely:**
  1. **Duplicated logic**, caught by `jscpd`: `apps/api/src/main.ts:27-36` and `apps/worker/src/main.ts:22-29` contain the identical 7-line classifier-selection block (`anthropicApiKey ? createAnthropicRescueClassifier(...) : heuristicRescueClassifier`, plus the matching `logger.warn`). Two entrypoints independently re-derive the same wiring because there's no shared home for it that isn't "one app importing the other."
  2. **Deployment coupling**: building/deploying `apps/api` today pulls in `apps/worker`'s full dependency tree — `node-cron`, `@anthropic-ai/sdk`, `google-auth-library` (a second copy, alongside `apps/api`'s own) — none of which the API process needs at runtime for anything except the one re-exported orchestration function.
  3. **Blocks the spec's own intended evolution**: the architecture diagram calls for the API to *enqueue* work, not call the worker in-process. As long as `apps/api` statically imports `@inboxrulz/worker`'s run function, introducing a real queue (BullMQ/Redis, as the spec anticipates) means removing this import, not adding to it — it's a dependency that will need to be *undone*, not extended.
- **Fix:** extract `runOnce`/`planForRule` (currently `apps/worker/src/runner.ts`) and the classifier-selection wiring into a new `packages/orchestrator` (or fold into `packages/mail-connector`/a new small package — naming is a judgment call, not load-bearing). Both `apps/worker` (the cron entrypoint) and `apps/api` (the manual "run now" entrypoint) depend on that package; neither depends on the other. This is a pure move-and-relink refactor — no logic changes — and directly eliminates the duplicated classifier block as a side effect. See `PLAN.md` Stage 2, item 1.

### <a name="b2-two-god-functions-buildserver-and-accountpage"></a>B2 — `buildServer()` is a 156-line function defining all 7 routes inline
**Severity: Medium. Effort: S–M.**
- **What:** `apps/api/src/server.ts:67-222`. One function does route registration, request validation, business logic, and audit logging for `/health`, `/accounts` (GET/POST), `/accounts/:id/rules` (GET), `/accounts/:id/rules/:type` (PUT), `/accounts/:id/run` (POST), `/accounts/:id/runs` (GET), and `/accounts/:id/runs/:runId/actions` (GET) — all as inline closures inside `buildServer`.
- **Measurement:** ESLint `max-lines-per-function`: 137 counted lines (excluding blank/comments) against a 60-line threshold — more than double.
- **Cost:** this single function is also where [B3](#b3-repeated-authownership-preamble-in-every-route)'s duplication lives, and it's the reason `apps/api/src/server.ts:213-218` (the last route) has zero dedicated test coverage — the file is long enough that a whole route can go untested without it being obvious from a glance at the test file, which tests routes somewhat unevenly.
- **Fix:** Fastify's own idiom for this is a `preHandler` hook (see B3) plus splitting route registration into per-resource plugin files (`routes/accounts.ts`, `routes/rules.ts`, `routes/runs.ts`), each registered via `app.register()`. This is incremental and testable one route-group at a time.

### <a name="b3-repeated-authownership-preamble-in-every-route"></a>B3 — The same 5-line auth+ownership preamble repeats in 5 of 7 routes
**Severity: Medium. Effort: S.**
- **What:** `apps/api/src/server.ts` — this exact block appears verbatim in the `GET /accounts/:id/rules` (lines 91-95), `PUT /accounts/:id/rules/:type` (96-100), `POST /accounts/:id/run` (167-171), `GET /accounts/:id/runs` (203-207), and `GET /accounts/:id/runs/:runId/actions` (212-216) handlers:
  ```ts
  const user = await authenticate(request, reply, deps.verifyIdToken, logger);
  if (!user) return;
  const { id } = request.params as { id: string };
  const account = await loadOwnedAccount(repository, logger, user.uid, id);
  if (!account) return reply.code(404).send({ error: "Account not found" });
  ```
- **Measurement:** manual read (confirmed by `jscpd` catching 2 of these 5 occurrences above its 30-token threshold — the other 3 are the same pattern with different surrounding context, which drops them below jscpd's clone-detection window, so the true duplication count is higher than the tool's raw output).
- **Cost:** every new authenticated, account-scoped route added to this file will keep copying this block by hand — the next person doing so has no way to discover it should be shared instead, and any future change to the auth/ownership contract (e.g., adding rate-limiting, or changing the 404-vs-403 policy) has to be made in 5 places and is easy to miss in a 6th.
- **Fix:** a Fastify `preHandler` hook, registered once per route group (or via `app.decorateRequest`), that does exactly this and attaches the resolved `account` to `request`. Each handler becomes 1-2 lines shorter than its current body and the security-relevant logic exists in exactly one place. This is the same fix that shrinks B2's `buildServer` and should be done together.

### <a name="c1-coverage-gap-is-concentrated-on-the-riskiest-code"></a>C1 — Coverage gap is concentrated on the riskiest code
**Severity: High. Effort: M** (writing the tests; no production code changes needed).
- **What:** three files sit at **exactly 0% coverage**, and none of them are incidental:
  - `apps/worker/src/connectorFactory.ts` (1-50) — decrypts stored OAuth credentials and constructs the Gmail client. This is the one place in the whole codebase where encrypted-at-rest credentials are decrypted and handed to a provider SDK.
  - `apps/worker/src/rescueClassifier.ts` (1-94) — builds the LLM prompt and parses its JSON response for the one judgment-based rule. `parseResponse()`'s malformed-JSON fallback path (the safety net that defaults to "not important" on a bad LLM response) has never been exercised by a test.
  - `apps/api/src/firebaseAuth.ts` (1-30) — verifies the bearer token that gates every authenticated route in the product.
  - Plus, within `apps/api/src/server.ts`: the `POST /accounts/:id/run` failure branch (178-187, the 502 path) and the entire `GET /accounts/:id/runs/:runId/actions` route (212-218) have no test exercising them at all.
- **Measurement:** `vitest --coverage` (v8 provider) per package, `text` reporter, this session.
- **Cost:** this is precisely the "low coverage + high complexity/risk" intersection the audit brief asks to prioritize — except here it's "low coverage + high *consequence of a silent bug*" rather than high complexity (none of these files are individually complex). A silent regression in credential decryption, in the classifier's malformed-response handling, or in token verification would each be a security-relevant bug that today's test suite cannot catch.
- **Why it happened:** all three untested files share a trait — they're the ones that talk to a real external system (Google's OAuth token endpoint, the Gmail API via a constructed client, Anthropic's API, Firebase's public key endpoint) that the existing tests correctly chose not to call for real. But "don't call the real API in a test" doesn't require "don't test the function at all" — `firebaseAuth.ts`'s `getFirebaseApp()` singleton logic, `rescueClassifier.ts`'s `buildPrompt`/`parseResponse` (already written as separate, pure-ish functions — they're just not exported or tested), and `connectorFactory.ts`'s provider-switch/error-message logic are all testable with a mocked SDK, the same pattern already used successfully for `GmailConnector.test.ts` (which mocks the `gmail_v1.Gmail` client shape directly).
- **Fix:** see `PLAN.md` Stage 1, items 3-5 — add coverage using the same mocking pattern already proven in this codebase, not a new testing approach.

### <a name="d1-account-page-is-a-god-component"></a>D1 — `AccountPage` is a 201-line component doing five jobs
**Severity: Medium. Effort: M.**
- **What:** `apps/web/app/accounts/[id]/page.tsx:55-256`. One component: gates on auth, fetches account+rules+runs concurrently, renders the rule-toggle list, renders the run-log table, renders the run-actions detail table, and owns four separate mutation handlers (`toggleRule`, `saveConfig`, `handleRunNow`, `showActions`).
- **Measurement:** ESLint `max-lines-per-function`: 186 counted lines against a 60-line threshold, the largest function in the codebase by a wide margin (next largest is `buildServer` at 137).
- **Cost:** onboarding friction is the real cost here, not bugs — a new contributor asked to "add a column to the run log table" has to read all 201 lines to find the ~15 that matter, and any future change to one concern (e.g., how rule config fields render) risks an unrelated diff touching the run-log JSX purely because they're in the same function.
- **Fix:** split along the existing implicit seams — `RuleList` (the rule-toggle card), `RunLog` (the table + "Run now" button), `RunActionsTable` (the detail view) as three components taking props, with `AccountPage` reduced to data-fetching + composition. No behavior change; a pure extraction refactor, each piece independently readable.

### <a name="d2-no-timeoutretrybackoff-on-outbound-gmail-calls"></a>D2 — No timeout/retry/backoff on outbound Gmail API calls
**Severity: Medium (not yet triggered in production — nothing is deployed yet — but explicitly anticipated by the spec). Effort: M.**
- **What:** `packages/mail-connector/src/gmail/GmailConnector.ts` — every one of the 6 `this.gmail.users.*` calls (lines 35, 44, 64, 89, 103, 114) uses the raw `googleapis` client with no explicit timeout, no retry-with-backoff, and no rate-limit handling.
- **Measurement:** manual read of every I/O call site in the file.
- **Cost:** the spec itself (§9) already names this: "Rate limits per provider (Gmail API quotas, Microsoft Graph throttling) need per-tenant backoff in the worker, not just global." A stuck or rate-limited Gmail call today has no timeout, so a single account's run could hang the worker process indefinitely rather than failing fast into the existing per-rule error handling (`runner.ts`'s try/catch already does the right thing *if* the call ever returns/throws — the gap is that it might never do either).
- **Fix:** wrap the `googleapis` client construction with a reasonable request timeout (the `googleapis` client accepts `timeout`/`retry` options directly — this doesn't need a new dependency) and confirm 429/5xx responses surface as a normal thrown error the existing per-rule try/catch already handles. This is a self-contained change to one file's constructor.

### <a name="d3-duplicated-sign-in-gate-across-both-pages"></a>D3 — Duplicated sign-in gate across both pages
**Severity: Low. Effort: S.**
- **What:** `apps/web/app/page.tsx:47-61` and `apps/web/app/accounts/[id]/page.tsx:129-141` both implement the same `if (authLoading) return null; if (!user) { return <...sign-in card...>; }` gate.
- **Measurement:** `jscpd` (`web/app/accounts/[id]/page.tsx [138:38-147:8]` clone of `web/app/page.tsx [56:113-65:8]`).
- **Cost:** low today (only 2 occurrences — this is a "rule of three" judgment call, and reasonable people could leave it until a third page copies it). Flagging it now because the fix is cheap and every future page will otherwise copy it a third time before anyone notices.
- **Fix:** extract a `<RequireAuth>` wrapper component (or a `useRequireAuth()` hook returning early-render JSX) used by both pages.

### Findings considered and deliberately not raised

Per the audit brief's own instruction to distinguish "violates a principle" from "causes a problem here," the following were checked and are **not** findings:

- **LSP / inheritance depth / composition-over-inheritance:** `grep -rn "class .* extends"` across the whole repo returns zero matches. There is no inheritance anywhere (only `implements` against 2 interfaces, `Repository` and `MailConnector`). These principles are vacuously satisfied — there's nothing to critique and nothing to praise.
- **ISP:** both interfaces (`Repository`, `MailConnector`) are fully implemented by every implementer with no stubbed/throwing methods. No fat-interface smell.
- **OCP on the rule-type switch statements** (`apps/worker/src/runner.ts:96` `planForRule()`'s switch over 5 rule types; `GmailConnector.applyAction()`'s switch over 6 action types): both are textbook OCP violations — adding a rule/action type means editing existing code. Left alone deliberately: the spec defines exactly 5 rule types and 6 action types as a closed, stable set (not a plugin system), and introducing a registry/strategy-pattern abstraction for a set that has not grown and has no near-term second dimension to extend along would be the speculative-generality the brief also warns against.
- **DRY on `db/src/inMemoryRepository.ts` vs `db/src/repository.ts`:** see Phase 1 duplication section — this is an interface mirroring its implementation, not true duplication.
- **Primitive obsession, minor:** `PlannedAction.label?: string` (`packages/rules-engine/src/types.ts:55`) is optional and only meaningful for `label`/`unlabel` actions; `GmailConnector.ts:127`'s `requireLabel()` exists purely to convert a missing-label bug from a type error into a runtime throw. A discriminated union (`{action: "label", label: string} | {action: "archive"} | ...`) would let the compiler catch this instead. Real, but small (effort S, low severity) — noted here rather than promoted to a numbered finding because it's a nice-to-have type-safety tightening, not a source of an actual bug class today (the one call site that can omit `label` is already guarded).
