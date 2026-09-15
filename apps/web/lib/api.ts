const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const USER_ID_KEY = "inboxrules_user_id";

/**
 * Stand-in for real session auth (see apps/api/src/auth.ts) — a random id
 * generated once per browser and sent as `x-user-id`. Good enough to
 * demo/dev against; a real login system replaces this, not the API's
 * per-account authorization checks, which stay the same either way.
 */
export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      // Fastify's JSON parser rejects an empty body sent with this header
      // (e.g. the bodyless "run now" POST), so only set it when there's
      // actually a body to parse.
      ...(init.body ? { "content-type": "application/json" } : {}),
      "x-user-id": getUserId(),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Account {
  id: string;
  userId: string;
  provider: string;
  displayName: string;
  status: string;
  connectedAt: string;
}

export interface Rule {
  id: string;
  connectedAccountId: string;
  type: string;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

export interface Run {
  id: string;
  connectedAccountId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  error: string | null;
}

export interface RunAction {
  id: string;
  runId: string;
  ruleId: string;
  threadId: string;
  action: string;
  reason: string;
  createdAt: string;
}

export const api = {
  listAccounts: () => request<Account[]>("/accounts"),
  connectAccount: (body: { provider: string; displayName: string; credentials: Record<string, unknown> }) =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  getAccount: async (id: string) => (await api.listAccounts()).find((a) => a.id === id) ?? null,
  listRules: (accountId: string) => request<Rule[]>(`/accounts/${accountId}/rules`),
  upsertRule: (
    accountId: string,
    type: string,
    body: { enabled: boolean; order?: number; config?: Record<string, unknown> },
  ) => request<Rule>(`/accounts/${accountId}/rules/${type}`, { method: "PUT", body: JSON.stringify(body) }),
  runNow: (accountId: string) =>
    request<{ run: Run; actions: RunAction[] }>(`/accounts/${accountId}/run`, { method: "POST" }),
  listRuns: (accountId: string) => request<Run[]>(`/accounts/${accountId}/runs`),
  listActions: (accountId: string, runId: string) =>
    request<RunAction[]>(`/accounts/${accountId}/runs/${runId}/actions`),
};
