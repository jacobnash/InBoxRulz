"use client";

import { useEffect, useState } from "react";
import { subscribeToAuthChanges, type User } from "./firebase";

export interface AuthState {
  user: User | null;
  /** True until Firebase has resolved the initial auth state — avoids a
   * flash of "please sign in" while a valid session is still loading. */
  loading: boolean;
}

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    return subscribeToAuthChanges((user) => setState({ user, loading: false }));
  }, []);

  return state;
}
