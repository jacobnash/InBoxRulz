import { getFirebaseAuth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Every API call is authenticated with the signed-in Firebase user's ID
 * token (see apps/api/src/auth.ts, which verifies it server-side) — this
 * replaces the old x-user-id placeholder header entirely. Firebase's SDK
 * refreshes the token under the hood when it's close to expiry, so calling
 * getIdToken() per-request (rather than caching it) is the correct usage,
 * not wasteful. */
async function getAuthHeader(): Promise<Record<string, string>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }
  const token = await user.getIdToken();
  return { authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      // Fastify's JSON parser rejects an empty body sent with this header
      // (e.g. the bodyless "run now" POST), so only set it when there's
      // actually a body to parse.
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...authHeader,
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
