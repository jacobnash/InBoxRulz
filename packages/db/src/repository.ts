import type {
  ActionType,
  ConnectedAccountRecord,
  RuleRecord,
  RuleType,
  RunActionRecord,
  RunRecord,
  RunStatus,
  RunTrigger,
} from "./models.js";

/**
 * Port the worker and API depend on instead of a concrete database client.
 * `InMemoryRepository` (./inMemoryRepository.ts) is a fully-working
 * reference implementation used in tests and local/offline dev; a
 * Postgres-backed implementation over the Prisma schema in
 * prisma/schema.prisma is the production swap-in behind this same
 * interface.
 */
export interface Repository {
  getConnectedAccount(id: string): Promise<ConnectedAccountRecord | null>;
  listActiveConnectedAccounts(): Promise<ConnectedAccountRecord[]>;
  listConnectedAccountsForUser(userId: string): Promise<ConnectedAccountRecord[]>;
  createConnectedAccount(input: {
    userId: string;
    provider: ConnectedAccountRecord["provider"];
    displayName: string;
    encryptedCredentials: string;
  }): Promise<ConnectedAccountRecord>;
  setAccountStatus(id: string, status: ConnectedAccountRecord["status"]): Promise<void>;

  listRulesForAccount(accountId: string): Promise<RuleRecord[]>;
  upsertRule(input: {
    connectedAccountId: string;
    type: RuleType;
    enabled: boolean;
    order: number;
    config: Record<string, unknown>;
  }): Promise<RuleRecord>;

  createRun(connectedAccountId: string, trigger: RunTrigger): Promise<RunRecord>;
  finishRun(runId: string, status: RunStatus, error?: string): Promise<RunRecord>;
  listRuns(connectedAccountId: string, limit?: number): Promise<RunRecord[]>;

  recordAction(input: {
    runId: string;
    ruleId: string;
    threadId: string;
    action: ActionType;
    reason: string;
  }): Promise<RunActionRecord>;
  listActionsForRun(runId: string): Promise<RunActionRecord[]>;
}
