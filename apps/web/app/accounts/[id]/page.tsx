"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type Account, type Rule, type Run, type RunAction } from "@/lib/api";

interface RuleField {
  key: string;
  label: string;
}

interface RuleDef {
  type: string;
  label: string;
  description: string;
  fields?: RuleField[];
}

const RULE_DEFS: RuleDef[] = [
  {
    type: "promo_archive",
    label: "Promo archive",
    description: "Archive inbox mail already classified as Promotions. No knobs — it's the provider's own classification.",
  },
  {
    type: "receipts_file",
    label: "Receipts filing",
    description: "Tag purchase-classified mail as Receipts and archive it. Never trashed by any other rule.",
  },
  {
    type: "delivered_trash",
    label: "Delivered-order cleanup",
    description: 'Trash mail that reads as a completed delivery ("has been delivered"), excluding receipts.',
    fields: [{ key: "gracePeriodDays", label: "Grace period before trashing (days)" }],
  },
  {
    type: "retention_purge",
    label: "Aging / retention purge",
    description: "Trash mail already archived once it's older than this threshold. Provider Trash expires it later on its own timeline.",
    fields: [{ key: "retentionDays", label: "Retention window (days)" }],
  },
  {
    type: "rescue",
    label: "Important-mail rescue",
    description: "Restore mail that looks personally/professionally important. Every restore is a one-time, permanent decision.",
    fields: [{ key: "lookbackDays", label: "Lookback window (days)" }],
  },
];

type RuleState = Record<string, { enabled: boolean; config: Record<string, unknown> }>;

export default function AccountPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;

  const [account, setAccount] = useState<Account | null>(null);
  const [ruleState, setRuleState] = useState<RuleState>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunActions, setSelectedRunActions] = useState<{ runId: string; actions: RunAction[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshAll() {
    try {
      const [acct, rules, runList] = await Promise.all([
        api.getAccount(accountId),
        api.listRules(accountId),
        api.listRuns(accountId),
      ]);
      setAccount(acct);
      setRuleState(mergeRuleState(rules));
      setRuns(runList);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function toggleRule(type: string, enabled: boolean) {
    const current = ruleState[type] ?? { enabled: false, config: {} };
    setRuleState((prev) => ({ ...prev, [type]: { ...current, enabled } }));
    try {
      await api.upsertRule(accountId, type, { enabled, config: current.config });
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveConfig(type: string, key: string, rawValue: string) {
    const current = ruleState[type] ?? { enabled: false, config: {} };
    const value = rawValue.trim() === "" ? undefined : Number(rawValue);
    const config = { ...current.config, ...(value !== undefined && !Number.isNaN(value) ? { [key]: value } : {}) };
    setRuleState((prev) => ({ ...prev, [type]: { ...current, config } }));
    try {
      await api.upsertRule(accountId, type, { enabled: current.enabled, config });
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setError(null);
    try {
      await api.runNow(accountId);
      await refreshAll();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function showActions(runId: string) {
    const actions = await api.listActions(accountId, runId);
    setSelectedRunActions({ runId, actions });
  }

  const title = useMemo(() => account?.displayName ?? accountId, [account, accountId]);

  return (
    <>
      <Link className="back-link" href="/">
        ← All inboxes
      </Link>
      <h1>{title}</h1>
      <p className="subtitle">{account?.provider}</p>

      <div className="card">
        <h2>Rules</h2>
        {RULE_DEFS.map((def) => {
          const state = ruleState[def.type] ?? { enabled: false, config: {} };
          return (
            <div className="rule-row" key={def.type}>
              <div>
                <div className="rule-name">{def.label}</div>
                <div className="rule-desc">{def.description}</div>
                {state.enabled &&
                  def.fields?.map((field) => (
                    <div key={field.key} style={{ marginTop: 8, maxWidth: 260 }}>
                      <label htmlFor={`${def.type}-${field.key}`}>{field.label}</label>
                      <input
                        id={`${def.type}-${field.key}`}
                        type="number"
                        defaultValue={String(state.config[field.key] ?? "")}
                        onBlur={(e) => saveConfig(def.type, field.key, e.target.value)}
                      />
                    </div>
                  ))}
              </div>
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(e) => toggleRule(def.type, e.target.checked)}
                aria-label={`Enable ${def.label}`}
              />
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Run log</h2>
        <button onClick={handleRunNow} disabled={running}>
          {running ? "Running…" : "Run now"}
        </button>
        {error && <p className="error">{error}</p>}

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Trigger</th>
              <th>Status</th>
              <th>Started</th>
              <th>Finished</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.trigger}</td>
                <td>{run.status}</td>
                <td>{new Date(run.startedAt).toLocaleString()}</td>
                <td>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}</td>
                <td>
                  <button className="secondary" onClick={() => showActions(run.id)}>
                    View actions
                  </button>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5}>No runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>

        {selectedRunActions && (
          <div style={{ marginTop: 20 }}>
            <h2>Actions for this run</h2>
            <table>
              <thead>
                <tr>
                  <th>Thread</th>
                  <th>Action</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {selectedRunActions.actions.map((action) => (
                  <tr key={action.id}>
                    <td>{action.threadId}</td>
                    <td>{action.action}</td>
                    <td>{action.reason}</td>
                  </tr>
                ))}
                {selectedRunActions.actions.length === 0 && (
                  <tr>
                    <td colSpan={3}>No matches this run.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function mergeRuleState(rules: Rule[]): RuleState {
  const state: RuleState = {};
  for (const def of RULE_DEFS) {
    state[def.type] = { enabled: false, config: {} };
  }
  for (const rule of rules) {
    state[rule.type] = { enabled: rule.enabled, config: rule.config };
  }
  return state;
}
