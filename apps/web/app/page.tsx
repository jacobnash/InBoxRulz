"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Account } from "@/lib/api";
import { useAuthUser } from "@/lib/useAuthUser";
import { signInWithGoogle } from "@/lib/firebase";

export default function HomePage() {
  const { user, loading: authLoading } = useAuthUser();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function refresh() {
    try {
      setAccounts(await api.listAccounts());
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  // /auth/google/callback redirects here with ?oauthError=... on failure
  // (there's nothing to read on success — it redirects straight to the
  // new account's own page instead).
  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get("oauthError");
    if (oauthError) {
      setError(`Google sign-in for Gmail failed: ${oauthError}`);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleConnectGoogle() {
    setError(null);
    setConnecting(true);
    try {
      const { url } = await api.connectGoogleStart();
      window.location.href = url;
    } catch (err) {
      setError(String(err));
      setConnecting(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return (
      <>
        <h1>InboxRules</h1>
        <p className="subtitle">Every connected inbox, and the rules quietly keeping it clean.</p>
        <div className="card">
          <h2>Sign in to continue</h2>
          <p className="rule-desc">Sign in with your Google account to see and manage your connected inboxes.</p>
          <button onClick={() => signInWithGoogle()}>Sign in with Google</button>
        </div>
      </>
    );
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
          Only Gmail is wired up so far — Outlook/IMAP adapters aren&apos;t built yet.
        </p>
        <button onClick={handleConnectGoogle} disabled={connecting}>
          {connecting ? "Redirecting to Google…" : "Connect with Google"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
