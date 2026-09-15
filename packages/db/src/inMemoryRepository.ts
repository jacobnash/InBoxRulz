import { randomUUID } from "node:crypto";
import type { Repository } from "./repository.js";
import type {
  ConnectedAccountRecord,
  RuleRecord,
  RunActionRecord,
  RunRecord,
} from "./models.js";

/**
 * In-memory `Repository`. Not for production (state vanishes on restart,
 * no multi-process consistency) — it exists so the worker/API logic and
 * their tests can run end-to-end without Postgres, and so a fresh checkout
 * can demo the whole pipeline before wiring up a real database.
 */
export class InMemoryRepository implements Repository {
  private accounts = new Map<string, ConnectedAccountRecord>();
  private rules = new Map<string, RuleRecord>();
  private runs = new Map<string, RunRecord>();
  private actions = new Map<string, RunActionRecord>();

  seedAccount(account: ConnectedAccountRecord): void {
    this.accounts.set(account.id, account);
  }

  seedRule(rule: RuleRecord): void {
    this.rules.set(rule.id, rule);
  }

  async getConnectedAccount(id: string): Promise<ConnectedAccountRecord | null> {
    return this.accounts.get(id) ?? null;
  }

  async listActiveConnectedAccounts(): Promise<ConnectedAccountRecord[]> {
    return [...this.accounts.values()].filter((a) => a.status === "active");
  }

  async listConnectedAccountsForUser(userId: string): Promise<ConnectedAccountRecord[]> {
    return [...this.accounts.values()].filter((a) => a.userId === userId);
  }

  async createConnectedAccount(input: {
    userId: string;
    provider: ConnectedAccountRecord["provider"];
    displayName: string;
    encryptedCredentials: string;
  }): Promise<ConnectedAccountRecord> {
    const account: ConnectedAccountRecord = {
      id: randomUUID(),
      status: "active",
      connectedAt: new Date(),
      ...input,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async setAccountStatus(id: string, status: ConnectedAccountRecord["status"]): Promise<void> {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`Unknown account ${id}`);
    this.accounts.set(id, { ...account, status });
  }

  async listRulesForAccount(accountId: string): Promise<RuleRecord[]> {
    return [...this.rules.values()]
      .filter((r) => r.connectedAccountId === accountId)
      .sort((a, b) => a.order - b.order);
  }

  async upsertRule(input: {
    connectedAccountId: string;
    type: RuleRecord["type"];
    enabled: boolean;
    order: number;
    config: Record<string, unknown>;
  }): Promise<RuleRecord> {
    const existing = [...this.rules.values()].find(
      (r) => r.connectedAccountId === input.connectedAccountId && r.type === input.type,
    );
    const now = new Date();
    const rule: RuleRecord = existing
      ? { ...existing, ...input, updatedAt: now }
      : {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...input,
        };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async createRun(connectedAccountId: string, trigger: RunRecord["trigger"]): Promise<RunRecord> {
    const run: RunRecord = {
      id: randomUUID(),
      connectedAccountId,
      trigger,
      startedAt: new Date(),
      finishedAt: null,
      status: "running",
      error: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async finishRun(
    runId: string,
    status: RunRecord["status"],
    error?: string,
  ): Promise<RunRecord> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const updated: RunRecord = { ...run, status, error: error ?? null, finishedAt: new Date() };
    this.runs.set(runId, updated);
    return updated;
  }

  async listRuns(connectedAccountId: string, limit = 20): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.connectedAccountId === connectedAccountId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async recordAction(input: {
    runId: string;
    ruleId: string;
    threadId: string;
    action: RunActionRecord["action"];
    reason: string;
  }): Promise<RunActionRecord> {
    const action: RunActionRecord = {
      id: randomUUID(),
      createdAt: new Date(),
      ...input,
    };
    this.actions.set(action.id, action);
    return action;
  }

  async listActionsForRun(runId: string): Promise<RunActionRecord[]> {
    return [...this.actions.values()].filter((a) => a.runId === runId);
  }
}
