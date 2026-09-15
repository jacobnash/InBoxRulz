"use client";

import { useAuthUser } from "@/lib/useAuthUser";
import { signInWithGoogle, signOutUser } from "@/lib/firebase";

/** Sign-in/sign-out bar shown at the top of every page. Pages that require
 * auth (both of them, today) gate their own content on `useAuthUser()`
 * separately — this component only renders the control, not the gate. */
export function AuthBar() {
  const { user, loading } = useAuthUser();

  if (loading) return null;

  if (!user) {
    return (
      <div className="auth-bar">
        <button onClick={() => signInWithGoogle()}>Sign in with Google</button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <span className="auth-email">{user.email}</span>
      <button className="secondary" onClick={() => signOutUser()}>
        Sign out
      </button>
    </div>
  );
}
