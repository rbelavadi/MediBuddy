// lib/auth.ts
//
// WHY CENTRALISE AUTH HERE?
// -------------------------
// Supabase provides auth methods directly on the client (`supabase.auth.getUser()`,
// `supabase.auth.onAuthStateChange(...)`, etc.). We *could* call these inline in
// every component that needs to know who's logged in — but that leads to two problems:
//
//   1. Code duplication: every component re-implements the same subscription logic.
//   2. Stale data: without a shared listener, components can show different auth states
//      simultaneously (one thinks you're logged in, another doesn't).
//
// By centralising in this one hook, all components get the same live session object,
// and if we ever swap auth providers (e.g., move from Supabase Auth to NextAuth),
// we only change this one file.
//
// Tradeoff: React hooks only work in Client Components (files with "use client" at top).
// For Server Components that need the user, we'd use `supabase.auth.getUser()` directly
// in the server function instead — we'll cross that bridge in a later chunk.

"use client"; // This directive makes the hook available on the client side only

import { useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface UseUserReturn {
  user: User | null;      // The logged-in user object, or null if not authenticated
  session: Session | null; // The full session (includes access token, expiry, etc.)
  loading: boolean;        // True on first load while we check localStorage for an existing session
}

export function useUser(): UseUserReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Step 1: On mount, grab whatever session is already stored locally.
    // Supabase persists sessions in localStorage, so a page refresh won't log users out.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Step 2: Subscribe to future auth changes (login, logout, token refresh).
    // This fires whenever the auth state changes anywhere in the app, keeping all
    // components in sync automatically.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Step 3: Clean up the subscription when this component unmounts.
    // Without this, the listener would keep running even after the component is gone,
    // causing memory leaks and potential state updates on unmounted components.
    return () => subscription.unsubscribe();
  }, []); // Empty dependency array = run once on mount only

  return {
    user: session?.user ?? null,
    session,
    loading,
  };
}
