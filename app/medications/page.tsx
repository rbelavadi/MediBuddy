// app/medications/page.tsx  (route: "/medications")
//
// This is the patient's personal medication list — a protected page that
// shows every medication they have uploaded, rendered as MedicationCards.
//
// PROTECTED PAGE: What this means
// ---------------------------------
// "Protected" = only logged-in users can see it. We check the auth state
// via useUser(). If there's no session, we redirect to /auth immediately.
// The database also enforces this via RLS — even if someone bypassed the
// redirect, they could only retrieve their own rows.

"use client"; // Required: uses hooks (useUser, useState, useEffect)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import MedicationCard, { type MedicationRecord } from "@/components/MedicationCard";
import { useUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// ─── Empty State Illustration ──────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "64px 24px" }}>
      {/* Simple pill icon as SVG — no external image needed */}
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        aria-hidden="true"
        style={{ margin: "0 auto 24px" }}
      >
        <circle cx="40" cy="40" r="40" fill="#EBF3FD" />
        <ellipse cx="40" cy="40" rx="18" ry="10" stroke="#1E6FD9" strokeWidth="2.5" fill="none" transform="rotate(-45 40 40)" />
        <line x1="27" y1="27" x2="53" y2="53" stroke="#1E6FD9" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <h2
        style={{
          fontFamily: "var(--font-lora)",
          fontSize: "1.5rem",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: "12px",
        }}
      >
        No medications yet
      </h2>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "1rem",
          maxWidth: "380px",
          margin: "0 auto",
          lineHeight: 1.6,
        }}
      >
        Upload your first medication to get started.
        Go to the Home page and take a photo of your pill bottle or prescription label.
      </p>
    </div>
  );
}

// ─── Page Component ────────────────────────────────────────────────────────────
export default function MedicationsPage() {
  // WHAT IS useEffect?
  // -------------------
  // useEffect lets you run "side effects" — code that reaches outside the
  // component, like fetching data from a database. It runs AFTER React
  // has painted the component to the screen.
  //
  // The second argument (the dependency array []) controls when it re-runs:
  //   []        → run once, when the component first mounts (like __init__ in Python)
  //   [user]    → re-run whenever `user` changes
  //   (nothing) → run after every single render (rarely what you want)

  const [medications, setMedications] = useState<MedicationRecord[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const { user, loading: authLoading } = useUser();
  const router = useRouter();

  // ── Fetch medications from Supabase ──────────────────────────────────────
  useEffect(() => {
    // Don't fetch anything while we're still checking auth
    if (authLoading) return;

    // Redirect if not logged in
    if (!user) {
      router.push("/auth");
      return;
    }

    async function fetchMedications() {
      try {
        // WHY WE DON'T MANUALLY FILTER BY user_id (but do it anyway)
        // ------------------------------------------------------------
        // Supabase RLS automatically ensures this query only returns rows where
        // user_id matches the currently authenticated user. Even if we wrote
        // `.from("medications").select("*")` with no .eq() filter, we'd still
        // only get our own data — the database enforces it invisibly.
        //
        // However, we add `.eq("user_id", user.id)` anyway as a good habit:
        //   1. It makes the intent explicit and readable
        //   2. If RLS were ever accidentally disabled, this is a second line of defence
        //   3. It's a useful index hint for the query planner on large tables
        const { data, error: fetchError } = await supabase
          .from("medications")
          .select("*")
          .eq("user_id", user!.id)           // Belt-and-suspenders filter (RLS also handles this)
          .order("created_at", { ascending: false }); // Newest medications first

        if (fetchError) throw fetchError;

        setMedications((data as MedicationRecord[]) ?? []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load medications.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchMedications();
  }, [user, authLoading, router]);
  // ↑ This effect re-runs if user or authLoading changes (e.g., user logs out)

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />

      <main
        className="page-bg"
        style={{ flex: 1, padding: "48px 24px 64px" }}
      >
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>

          {/* ── Page Header ───────────────────────────────────────────────── */}
          <div style={{ marginBottom: "40px" }}>
            <h1
              style={{
                fontFamily: "var(--font-lora)",
                fontSize: "clamp(1.8rem, 4vw, 2.4rem)",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              Your Medications
            </h1>
            {!loading && medications.length > 0 && (
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", fontWeight: 500 }}>
                {medications.length} medication{medications.length !== 1 ? "s" : ""} on record
              </p>
            )}
          </div>

          {/* ── Loading State ─────────────────────────────────────────────── */}
          {(loading || authLoading) && (
            <div style={{ textAlign: "center", padding: "64px 0" }}>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "1.05rem",
                  fontWeight: 500,
                }}
              >
                Loading your medications...
              </p>
              <div style={{ marginTop: "20px", display: "flex", gap: "8px", justifyContent: "center" }}>
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}

          {/* ── Error State ───────────────────────────────────────────────── */}
          {error && !loading && (
            <div
              style={{
                backgroundColor: "#FFF5F5",
                border: "1px solid #FEB2B2",
                borderRadius: "var(--radius)",
                padding: "24px",
                color: "#C53030",
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Empty State ───────────────────────────────────────────────── */}
          {!loading && !error && medications.length === 0 && (
            <div
              style={{
                backgroundColor: "var(--card-bg)",
                borderRadius: "12px",
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border)",
              }}
            >
              <EmptyState />
            </div>
          )}

          {/* ── Medication List ───────────────────────────────────────────── */}
          {!loading && !error && medications.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "28px",
              }}
            >
              {medications.map((med) => (
                // PROPS IN ACTION:
                // We pass each medication record to MedicationCard as a prop.
                // MedicationCard doesn't know how to fetch its own data — it just
                // receives what it needs from the parent (this page) and renders it.
                // This separation makes MedicationCard reusable and easy to test.
                <div key={med.id} className="animate-fade-up">
                  <MedicationCard
                    medication={med}
                    showConfirmation={false} // Don't show "Added to list" on the list page
                  />
                </div>
              ))}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
