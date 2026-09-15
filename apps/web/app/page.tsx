"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Account } from "@/lib/api";

export default function HomePage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [credentialsJson, setCredentialsJson] = useState('{\n  "accessToken": "...",\n  "refreshToken": "..."\n}');
  const [connecting, setConnecting] = useState(false);

  async function refresh() {
    try {
      setAccounts(await api.listAccounts());
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      const credentials = JSON.parse(credentialsJson);
      await api.connectAccount({ provider: "gmail", displayName, credentials });
      setDisplayName("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <>
      <h1>InboxRules</h1>
      <p className="subtitle">Every connected inbox, and the rules quietly keeping it clean.</p>

      <div className="card">
        <h2>Connected inboxes</h2>
        {accounts === null && <p>Loading…</p>}
        {accounts?.length === 0 && <p>No inboxes connected yet — add one below.</p>}
        {accounts?.map((account) => (
          <div className="account-row" key={account.id}>
            <div>
              <Link href={`/accounts/${account.id}`}>{account.displayName}</Link>
              <span className="pill">{account.provider}</span>
              {account.status !== "active" && <span className="pill disabled">{account.status}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Connect an inbox</h2>
        <p className="rule-desc">
          This is a placeholder for the real Gmail/Outlook OAuth consent flow (spec section 9 — that
          needs a registered, provider-reviewed OAuth app). For now, paste an already-obtained token
          set to wire up the rest of the pipeline end to end.
        </p>
        <form onSubmit={handleConnect}>
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="me@gmail.com"
          />
          <br />
          <br />
          <label htmlFor="credentials">Credentials JSON</label>
          <textarea
            id="credentials"
            value={credentialsJson}
            onChange={(e) => setCredentialsJson(e.target.value)}
          />
          <br />
          <br />
          <button type="submit" disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Gmail inbox"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
