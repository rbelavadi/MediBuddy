// app/auth/page.tsx
//
// This page lives at the route /auth. It handles both login and signup —
// using a single card with a toggle between the two modes.
// Having one page (not two) reduces the URL surface area and feels less
// overwhelming for users who just want to "get in".
//
// NEXT.JS ROUTE CONVENTION: Any folder inside app/ becomes a URL segment.
// So app/auth/page.tsx → available at /auth.

"use client"; // Required because this component uses React hooks (useState)

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Logo mark used on this page ──────────────────────────────────────────────
function MedicalCrossLarge() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="18" y="4"  width="12" height="40" rx="3" fill="#1E6FD9" />
      <rect x="4"  y="18" width="40" height="12" rx="3" fill="#1E6FD9" />
    </svg>
  );
}

export default function AuthPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  //
  // WHAT IS useState?
  // useState is a React hook that lets a component "remember" a value between
  // renders. When you call setMode("signup"), React re-renders the component
  // and mode will now be "signup". Without useState, any variable you set
  // would reset to its initial value on every render.
  //
  // In Python terms: it's like an instance variable on a class, except React
  // manages the lifecycle for you.

  const [mode, setMode]         = useState<"login" | "signup">("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const router = useRouter();

  // ── Form submission handler ────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); // Prevent the default browser form submission (page reload)
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        // WHAT supabase.auth.signInWithPassword DOES:
        // Sends the email + password to Supabase's auth service. Supabase checks
        // them against its user table, and if they match, returns a session object
        // containing a JWT (JSON Web Token) access token. This token is automatically
        // stored in the browser's localStorage by the Supabase client, so the user
        // stays logged in even after a page refresh.
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;

      } else {
        // WHAT supabase.auth.signUp DOES:
        // Creates a new user in the Supabase auth table with the given email + password.
        // By default, Supabase sends a confirmation email — the user must click the link
        // before they can log in. You can disable this in: Supabase Dashboard →
        // Authentication → Providers → Email → "Confirm email" toggle.
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
      }

      // On success, redirect to the home page.
      // router.push() does a client-side navigation — fast, no full page load.
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setLoading(false); // Always re-enable the button, even if something failed
    }
  }

  const isLogin = mode === "login";

  return (
    // WHY justify-start INSTEAD OF justify-center:
    // justify-center vertically centers the flex child. If the card is taller
    // than the viewport (possible on small screens), the top of the card gets
    // pushed above the visible area and the user can't scroll back up to it —
    // which hides the submit button. justify-start (the default) pins the card
    // to the top of the container, and py-16 provides generous breathing room.
    // The card is always fully reachable by scrolling down.
    <div
      className="page-bg min-h-screen flex flex-col items-center justify-start px-4 py-16"
      role="main"
    >
      {/* ── Card ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: "var(--card-bg)",
          borderRadius: "12px",
          boxShadow: "var(--shadow-elevated)",
          border: "1px solid var(--border)",
          width: "100%",
          maxWidth: "460px",
          padding: "36px 36px 40px", // Reduced top padding — button was being pushed off-screen
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <MedicalCrossLarge />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-lora)",
            fontSize: "2rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            textAlign: "center",
            marginBottom: "6px",
          }}
        >
          MediBuddy
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: "1rem",
            fontWeight: 500,
            marginBottom: "36px",
          }}
        >
          Your medications, explained clearly.
        </p>

        {/* ── Mode Toggle (Login / Sign Up) ─────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Login or Sign Up"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            backgroundColor: "#EBF3FD",
            borderRadius: "var(--radius)",
            padding: "4px",
            marginBottom: "32px",
          }}
        >
          {(["login", "signup"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={mode === tab}
              onClick={() => { setMode(tab); setError(null); }}
              style={{
                padding: "12px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-nunito)",
                fontSize: "1rem",
                fontWeight: 700,
                transition: "all 0.2s ease",
                backgroundColor: mode === tab ? "#FFFFFF" : "transparent",
                color: mode === tab ? "var(--blue-primary)" : "var(--text-secondary)",
                boxShadow: mode === tab ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* ── Form ─────────────────────────────────────────────────────────── */}
        {/*
          WHAT IS A CONTROLLED COMPONENT?
          --------------------------------
          In plain HTML, an <input> manages its own value internally — the browser
          owns the state. You can read it, but React doesn't control it.

          A "controlled component" flips this: React owns the value via useState,
          and the input is just a display of that state. The pattern is:
            value={email}             ← React drives what's shown
            onChange={e => setEmail(e.target.value)}  ← every keystroke updates state

          WHY THIS MATTERS FOR AUTOFILL:
          When a browser autofills a field, it writes directly to the DOM input's
          value — bypassing React's onChange event in some browsers. Without
          `value` bound to state, React and the browser can get out of sync:
          the input LOOKS filled, but React's state is still "". The form then
          submits with empty strings.

          With a controlled component, React re-renders on every state change and
          the `value` prop always reflects the true state — so even if autofill
          injects a value, the next render reconciles everything correctly.

          autoComplete="off" on the <form> is an additional signal to the browser
          to not aggressively autofill, though browsers increasingly ignore it.
          The real protection is the controlled component pattern above.
        */}
        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          {/* Email */}
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "14px 16px",
                border: "2px solid #E2E8F0",
                borderRadius: "8px",
                fontSize: "1rem",
                fontWeight: 500,
                color: "#1A202C",
                backgroundColor: "#FAFBFC",
                outline: "none",
                transition: "border-color 0.15s",
                boxSizing: "border-box",
                // WHY boxShadow HERE:
                // Browser autofill applies :-webkit-autofill which forces a yellow/blue
                // background via internal browser CSS that cannot be overridden with
                // background-color. The only reliable workaround is a large inset box-shadow
                // in the color you want — it paints over the autofill background while
                // leaving the text and border untouched.
                boxShadow: "inset 0 0 0 1000px #FAFBFC",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1E6FD9")}
              onBlur={(e)  => (e.target.style.borderColor = "#E2E8F0")}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "28px" }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              // WHY always "new-password" (not "current-password" on login):
              // "current-password" tells the browser "autofill this from your saved passwords",
              // which can prevent the user from typing freely — the browser intercepts keystrokes
              // to show its autofill dropdown. "new-password" tells the browser this is a field
              // where the user will type something themselves, suppressing aggressive autofill.
              // The tradeoff: password managers won't auto-suggest on the login form, but the
              // user can always open their password manager manually to paste.
              autoComplete="new-password"
              placeholder={isLogin ? "Your password" : "Choose a strong password"}
              style={{
                width: "100%",
                padding: "14px 16px",
                border: "2px solid #E2E8F0",
                borderRadius: "8px",
                fontSize: "1rem",
                fontWeight: 500,
                color: "#1A202C",
                backgroundColor: "#FAFBFC",
                outline: "none",
                transition: "border-color 0.15s",
                boxSizing: "border-box",
                boxShadow: "inset 0 0 0 1000px #FAFBFC", // Neutralises autofill background
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1E6FD9")}
              onBlur={(e)  => (e.target.style.borderColor = "#E2E8F0")}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              role="alert"
              style={{
                backgroundColor: "#FFF5F5",
                border: "1px solid #FEB2B2",
                borderRadius: "var(--radius)",
                padding: "14px 16px",
                marginBottom: "20px",
                color: "#C53030",
                fontSize: "0.95rem",
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {/*
            Submit button — WHY hard-coded hex instead of CSS variables:
            CSS custom properties (var(--blue-primary)) in inline `style` props
            can fail to resolve if the stylesheet hasn't fully loaded when React
            renders the component for the first time. This causes the button to
            render with no background, making the white text invisible.
            Hard-coded hex values are always available instantly — no stylesheet
            dependency. We use Tailwind classes as a backup layer too.
          */}
          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-bold rounded-lg transition-colors duration-150"
            style={{
              padding: "18px 16px",
              backgroundColor: loading ? "#93C5FD" : "#1E6FD9",
              color: "#FFFFFF",           // Explicit hex — never rely on inheritance for button text
              border: "none",
              borderRadius: "8px",
              fontSize: "1.2rem",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.01em",
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1558B0";
            }}
            onMouseLeave={(e) => {
              if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1E6FD9";
            }}
          >
            {loading
              ? "Please wait..."
              : isLogin
              ? "Sign In"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
