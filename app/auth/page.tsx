"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function MedicalCrossLarge() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="18" y="4"  width="12" height="40" rx="3" fill="#1E6FD9" />
      <rect x="4"  y="18" width="40" height="12" rx="3" fill="#1E6FD9" />
    </svg>
  );
}

export default function AuthPage() {
  const [mode, setMode]         = useState<"login" | "signup">("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="page-bg min-h-screen flex flex-col items-center justify-start px-4 py-16" role="main">
      <div
        style={{
          backgroundColor: "var(--card-bg)",
          borderRadius: "12px",
          boxShadow: "var(--shadow-elevated)",
          border: "1px solid var(--border)",
          width: "100%",
          maxWidth: "460px",
          padding: "36px 36px 40px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <MedicalCrossLarge />
        </div>
        <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)", textAlign: "center", marginBottom: "6px" }}>
          MediBuddy
        </h1>
        <p style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: "1rem", fontWeight: 500, marginBottom: "36px" }}>
          Your medications, explained clearly.
        </p>

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
                color: mode === tab ? "#1E6FD9" : "#4A5568",
                boxShadow: mode === tab ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="email" style={{ display: "block", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
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
                // Large inset shadow overrides the browser's :-webkit-autofill background color
                boxShadow: "inset 0 0 0 1000px #FAFBFC",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1E6FD9")}
              onBlur={(e)  => (e.target.style.borderColor = "#E2E8F0")}
            />
          </div>

          <div style={{ marginBottom: "28px" }}>
            <label htmlFor="password" style={{ display: "block", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              // "new-password" suppresses the browser's autofill dropdown, which can block typing.
              // Tradeoff: password managers won't auto-suggest; users can still paste manually.
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
                boxShadow: "inset 0 0 0 1000px #FAFBFC",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1E6FD9")}
              onBlur={(e)  => (e.target.style.borderColor = "#E2E8F0")}
            />
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-bold rounded-lg transition-colors duration-150"
            style={{
              padding: "18px 16px",
              backgroundColor: loading ? "#93C5FD" : "#1E6FD9",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "8px",
              fontSize: "1.2rem",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.01em",
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1558B0"; }}
            onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1E6FD9"; }}
          >
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
