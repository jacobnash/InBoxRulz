# InboxRules — Product & Technical Spec (draft v0.1)

*A multi-tenant service that lets anyone connect their email account(s) and get the same automated inbox-hygiene you already have running on your own Gmail: promos skip the inbox, receipts get filed, delivered orders get trashed, old junk ages out, and anything that looks important is rescued back to the top.*

This doc is written to hand directly to an engineering agent (Claude Code) as a build brief. It describes the product, the architecture, and which open-source pieces to fork instead of building from scratch.

---

## 1. Problem

People let a handful of Gmail filters (or nothing at all) manage a firehose of promotional email, receipts, shipping updates, and newsletters. The result is either an unusable inbox or filters so aggressive that real things (a job offer, a reply from a landlord) get silently buried in a folder nobody checks. There's no dashboard anywhere that shows "here's every rule quietly acting on your mail and what it did today."

## 2. Product vision

A dashboard where a user connects one or more email accounts (Gmail, Outlook/365, iCloud, Fastmail, Zoho, generic IMAP) and turns on a small set of well-designed default rules — plus can write their own — that keep every connected inbox down to "does this need my attention" without ever silently deleting something that mattered. Every action is logged, reversible where the underlying provider allows it, and inspectable per-rule.

This is the productized version of a Gmail automation already validated on a real inbox: 5 rule types, run daily, with a permanent-tag mechanism so the system never re-litigates a decision the user has already overridden.

## 3. Core concepts

| Concept | Definition |
|---|---|
| **Connected Inbox** | One authenticated email account (OAuth token or IMAP credentials) tied to a user |
| **Rule** | A named, ordered pair of (match query, action) scoped to one inbox |
| **Action** | `archive`, `trash`, `label/tag`, `restore-to-inbox`, `mark-read` |
| **Permanent tag** | A label the system applies after acting once on a thread via a *judgment-based* rule, so that rule never re-evaluates that thread again — this is what stops an LLM-classified "rescue" from looping if the user re-archives it |
| **Run** | One execution of all of a user's active rules against one inbox, on a schedule or triggered manually |
| **Run log** | Per-run record of what matched, what action was taken, and why (for judgment-based rules, the reasoning) |

## 4. The five default rule types (already validated on a live Gmail account)

1. **Promo archive** — deterministic: query the provider's own promo classification (Gmail `category:promotions`; IMAP/Outlook equivalent is header/heuristic-based) and archive matches out of the inbox. No LLM needed.
2. **Receipts filing** — deterministic: query purchase-classified mail (Gmail `category:purchases`), tag `Receipts`, archive from inbox. Kept forever, never trashed.
3. **Delivered-order cleanup** — deterministic phrase match ("has been delivered", "was delivered") minus false-positive terms ("out for delivery", "delayed") → trash. Receipts are excluded (handled by rule 2).
4. **Aging/retention purge** — deterministic: anything already archived by rule 1 (or tagged by a periodicals rule) older than a user-configurable threshold (default 30 days) → trash. Two-stage: provider Trash itself expires ~30 days later, so nothing is unrecoverable inside ~60 days total without the user noticing.
5. **Important-mail rescue** — judgment-based (needs LLM or a learned classifier): scan mail that landed outside the inbox in the last ~1–2 days for signals of being personally/professionally important (sender not on any known bulk list, subject/snippet reads like correspondence, optionally user-supplied keywords/companies/contacts) and restore it to the inbox, tagging it permanently so it's a one-time decision.

**Design principle carried through the whole product:** deterministic query-based rules do the bulk of the work (cheap, instant, fully explainable). The one LLM-judgment rule (rescue) is the expensive/fuzzy exception, and it's made *idempotent* via the permanent-tag mechanism so it never needs to re-reason about the same thread twice. This hybrid is the key cost/reliability lever for the whole product — don't run an LLM over every message, only over the narrow "is this the one thing that shouldn't have left the inbox" question.

## 5. Feature set

### MVP
- OAuth connect flow for Gmail and Microsoft 365/Outlook; app-password/IMAP connect for iCloud, Fastmail, Zoho, and generic IMAP+SMTP
- Turn the 5 default rules on/off per inbox, with the tunable knobs each needs (retention days, rescue keywords/contacts, custom sender allow/block lists)
- Dashboard: list of connected inboxes → per-inbox rule toggles → recent run log (what was archived/tagged/trashed/rescued, with counts and a sample of what matched)
- "Run now" manual trigger per inbox, in addition to the default daily schedule
- Safety rails: nothing is ever hard-deleted by the product itself — only moved to the provider's own Trash, which the provider then expires on its own timeline

### V2
- Custom rule builder (user writes their own match query + action, or describes it in natural language and the system proposes a query)
- Per-rule notifications (push/email) — e.g. "rescued 1 email" digest
- Shared/team inbox support
- Undo window UI (surface everything a run touched, one click to revert before the provider's own trash expiry)
- Cross-account view ("show me every receipt across all my inboxes")

## 6. Technical architecture

```
 ┌─────────────┐     ┌──────────────────┐     ┌───────────────────────┐
 │  Dashboard   │────▶│   API / Auth      │────▶│  Postgres              │
 │  (web app)   │     │  (users, OAuth,   │     │  users, connected_     │
 └─────────────┘     │   rule CRUD)      │     │  accounts (encrypted   │
                       └──────────────────┘     │  tokens), rules,       │
                                │                 │  run_logs              │
                                ▼                 └───────────────────────┘
                       ┌──────────────────┐
                       │  Scheduler/Queue  │   (cron per inbox, default daily;
                       │  (worker service) │    "run now" enqueues immediately)
                       └──────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Rules Engine     │  translates each active rule into
                       │                   │  a provider query + action; calls
                       │                   │  an LLM only for the rescue rule
                       └──────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Mail connector   │  MCP mail server(s) — one per
                       │  layer (MCP)      │  provider or one multi-provider
                       └──────────────────┘  server, invoked per connected inbox
                                │
                        ┌───────┼────────┐
                        ▼       ▼        ▼
                     Gmail   Outlook   IMAP/SMTP
                     API     Graph     (iCloud, Fastmail, Zoho, other)
```

Key point: the mail connector layer should **not** be a single long-lived chat session per user (that's what today's Claude-Code-based prototype does, and it works for one person). At product scale it needs to be a stateless service call: worker picks up a scheduled job → calls the MCP mail server with that user's credentials for that one inbox → applies the matched rules → writes a run log → done.

## 7. Open-source building blocks (forkable today)

| Repo | Language | Providers | Multi-account | Notes |
|---|---|---|---|---|
| [tecnologicachile/mail-mcp](https://github.com/tecnologicachile/mail-mcp) | Rust | IMAP, SMTP, EWS, Microsoft Graph, Gmail OAuth2, iCloud, Zoho, Fastmail | Yes (env-var based, per-account IDs) | **Best fork candidate for the connector layer.** MIT license, 31 tools across read/write/send/EWS, 64 tests, 76★/23 forks, actively maintained. Broadest provider coverage in one codebase. Needs adapting from static env-var accounts to dynamic per-tenant credentials pulled from your DB. |
| [navbuildz/gmail-mcp-server](https://github.com/navbuildz/gmail-mcp-server) | — | Gmail only | Yes, natively | Already does archive/label/auto-unsubscribe — closest in spirit to the rules you already have running. Good option if you want to ship Gmail-only first and add providers later. |
| [ai-zerolab/mcp-email-server](https://github.com/ai-zerolab/mcp-email-server) (Wh1isper) | — | IMAP/SMTP | Yes | Cross-platform, full-featured; a generic alternative to mail-mcp for IMAP-first designs. |
| [MarkusPfundstein/mcp-gsuite](https://github.com/MarkusPfundstein/mcp-gsuite) | — | Gmail + Calendar (Google Workspace) | — | Narrower scope, useful reference for Gmail+Calendar combined auth. |
| [n24q02m/better-email-mcp](https://github.com/n24q02m/better-email-mcp) | — | IMAP/SMTP | Yes, with auto-discovery | Newer, worth a look for the auto-discovery-of-account-settings feature (fewer setup fields for users). |

**Recommendation:** fork `tecnologicachile/mail-mcp` for the connector layer given its provider breadth and MIT license, but plan a focused engineering task to rework its account model from static config to dynamic multi-tenant credential lookup — that's the main gap between "personal tool" and "product."

## 8. Data model sketch

```
users(id, email, created_at)
connected_accounts(id, user_id, provider, encrypted_credentials, display_name, status, connected_at)
rules(id, connected_account_id, type, enabled, config_json, created_at)
   -- type: promo_archive | receipts_file | delivered_trash | retention_purge | rescue
   -- config_json holds per-type knobs: retention_days, rescue_keywords, sender_allow/block, etc.
runs(id, connected_account_id, started_at, finished_at, status)
run_actions(id, run_id, rule_id, thread_id, action, reason, created_at)
```

## 9. Security notes

- OAuth tokens and IMAP passwords must be encrypted at rest (e.g. KMS-backed envelope encryption), never logged in plaintext, never included in LLM prompts sent to a third-party model provider
- Each provider's OAuth app will need to go through that provider's verification/review process before requesting broad mail scopes for arbitrary end users (Google's OAuth verification in particular is a multi-week process for sensitive scopes like `gmail.modify`) — budget for this early, it's a launch-blocking dependency, not an afterthought
- Rate limits per provider (Gmail API quotas, Microsoft Graph throttling) need per-tenant backoff in the worker, not just global

## 10. Open questions / risks

- **Spam folder access:** in testing, the Gmail MCP connector used for the prototype could not read the Spam folder at all (likely a deliberate safety restriction upstream). Confirm whether a self-hosted/forked connector has the same restriction — if not, decide deliberately whether the product should ever act on Spam (there's a real argument for leaving it alone).
- **Cost model:** the rescue rule's LLM call is the main variable cost. Worth measuring tokens-per-run at pilot scale before pricing anything.
- **False positives on delivered-order trashing:** phrase-matching is a blunt instrument; consider a short user-configurable grace period (e.g. don't trash until N days after "delivered") as a safer default than immediate trash.
- **Cross-provider folder/label parity:** Gmail labels, Outlook categories, and IMAP folders are not the same primitive — the abstraction in the rules engine needs to normalize "tag this thread" across all three without losing provider-specific behavior (e.g. Gmail labels are non-exclusive; IMAP folders usually mean "move," not "tag").

## 11. Suggested build order

1. Fork `mail-mcp`, strip it down to Gmail + one other provider (Outlook) to prove the multi-provider abstraction early
2. Rework its credential model for dynamic multi-tenant lookup
3. Build the deterministic rules engine (rules 1–4) and worker/scheduler — ship this before touching the LLM rescue rule
4. Build the dashboard: connect flow, rule toggles, run log
5. Add the rescue rule (LLM-assisted) with the permanent-tag idempotency mechanism
6. Pilot on your own multiple inboxes once you have more than one connected, before opening it to anyone else
