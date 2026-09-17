import { PrismaClient, type Prisma } from "@prisma/client";
import type { Repository } from "./repository.js";
import type {
  ActionType,
  ConnectedAccountRecord,
  Provider,
  RuleRecord,
  RuleType,
  RunActionRecord,
  RunRecord,
  RunStatus,
  RunTrigger,
} from "./models.js";

/**
 * Postgres-backed `Repository`, over the schema in prisma/schema.prisma.
 * Structurally the same shapes as `InMemoryRepository` — see that file and
 * ./repository.ts for the contract this must satisfy (in particular:
 * `createConnectedAccount` defaults new accounts to "active", not the
 * schema's `pending` default, matching the in-memory reference impl).
 */
export class PostgresRepository implements Repository {
  constructor(private readonly prisma: PrismaClient) {}

  async getConnectedAccount(id: string): Promise<ConnectedAccountRecord | null> {
    const row = await this.prisma.connectedAccount.findUnique({ where: { id } });
    return row ? toAccount(row) : null;
  }

  async listActiveConnectedAccounts(): Promise<ConnectedAccountRecord[]> {
    const rows = await this.prisma.connectedAccount.findMany({ where: { status: "active" } });
    return rows.map(toAccount);
  }

  async listConnectedAccountsForUser(userId: string): Promise<ConnectedAccountRecord[]> {
    const rows = await this.prisma.connectedAccount.findMany({ where: { userId } });
    return rows.map(toAccount);
  }

  async createConnectedAccount(input: {
    userId: string;
    provider: ConnectedAccountRecord["provider"];
    displayName: string;
    encryptedCredentials: string;
  }): Promise<ConnectedAccountRecord> {
    const row = await this.prisma.connectedAccount.create({
      data: { ...input, provider: input.provider as Provider, status: "active" },
    });
    return toAccount(row);
  }

  async setAccountStatus(id: string, status: ConnectedAccountRecord["status"]): Promise<void> {
    await this.prisma.connectedAccount.update({ where: { id }, data: { status } });
  }

  async listRulesForAccount(accountId: string): Promise<RuleRecord[]> {
    const rows = await this.prisma.rule.findMany({
      where: { connectedAccountId: accountId },
      orderBy: { order: "asc" },
    });
    return rows.map(toRule);
  }

  async upsertRule(input: {
    connectedAccountId: string;
    type: RuleType;
    enabled: boolean;
    order: number;
    config: Record<string, unknown>;
  }): Promise<RuleRecord> {
    const row = await this.prisma.rule.upsert({
      where: {
        connectedAccountId_type: { connectedAccountId: input.connectedAccountId, type: input.type },
      },
      create: { ...input, config: input.config as Prisma.InputJsonValue },
      update: {
        enabled: input.enabled,
        order: input.order,
        config: input.config as Prisma.InputJsonValue,
      },
    });
    return toRule(row);
  }

  async createRun(connectedAccountId: string, trigger: RunTrigger): Promise<RunRecord> {
    const row = await this.prisma.run.create({ data: { connectedAccountId, trigger } });
    return toRun(row);
  }

  async finishRun(runId: string, status: RunStatus, error?: string): Promise<RunRecord> {
    const row = await this.prisma.run.update({
      where: { id: runId },
      data: { status, error: error ?? null, finishedAt: new Date() },
    });
    return toRun(row);
  }

  async listRuns(connectedAccountId: string, limit = 20): Promise<RunRecord[]> {
    const rows = await this.prisma.run.findMany({
      where: { connectedAccountId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return rows.map(toRun);
  }

  async recordAction(input: {
    runId: string;
    ruleId: string;
    threadId: string;
    action: ActionType;
    reason: string;
  }): Promise<RunActionRecord> {
    const row = await this.prisma.runAction.create({ data: input });
    return row;
  }

  async listActionsForRun(runId: string): Promise<RunActionRecord[]> {
    return this.prisma.runAction.findMany({ where: { runId } });
  }
}

// Prisma's generated row types are structurally identical to the hand-written
// domain types in ./models.ts (same field names — see the @map directives in
// prisma/schema.prisma) except for enums and JSON, which is what these narrow.
function toAccount(row: {
  id: string;
  userId: string;
  provider: string;
  displayName: string;
  encryptedCredentials: string;
  status: string;
  connectedAt: Date;
}): ConnectedAccountRecord {
  return { ...row, provider: row.provider as Provider, status: row.status as ConnectedAccountRecord["status"] };
}

function toRule(row: {
  id: string;
  connectedAccountId: string;
  type: string;
  enabled: boolean;
  order: number;
  config: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): RuleRecord {
  return {
    ...row,
    type: row.type as RuleType,
    config: (row.config as Record<string, unknown>) ?? {},
  };
}

function toRun(row: {
  id: string;
  connectedAccountId: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  error: string | null;
}): RunRecord {
  return { ...row, trigger: row.trigger as RunTrigger, status: row.status as RunStatus };
}

/** Builds a `PrismaClient` pinned to the given connection string, rather
 * than relying on `DATABASE_URL` being in `process.env` — keeps this
 * consistent with `packages/config`'s explicit secret-passing convention. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
