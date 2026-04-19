"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import MedicationCard, { type MedicationRecord } from "@/components/MedicationCard";
import { useUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "64px 24px" }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true" style={{ margin: "0 auto 24px" }}>
        <circle cx="40" cy="40" r="40" fill="#EBF3FD" />
        <ellipse cx="40" cy="40" rx="18" ry="10" stroke="#1E6FD9" strokeWidth="2.5" fill="none" transform="rotate(-45 40 40)" />
        <line x1="27" y1="27" x2="53" y2="53" stroke="#1E6FD9" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <h2 style={{ fontFamily: "var(--font-lora)", fontSize: "1.5rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "12px" }}>
        No medications yet
      </h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "1rem", maxWidth: "380px", margin: "0 auto", lineHeight: 1.6 }}>
        Upload your first medication to get started.
        Go to the Home page and take a photo of your pill bottle or prescription label.
      </p>
    </div>
  );
}

export default function MedicationsPage() {
  const [medications, setMedications] = useState<MedicationRecord[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const { user, loading: authLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }

    async function fetchMedications() {
      try {
        const { data, error: fetchError } = await supabase
          .from("medications")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false });

        if (fetchError) throw fetchError;
        setMedications((data as MedicationRecord[]) ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load medications.");
      } finally {
        setLoading(false);
      }
    }

    fetchMedications();
  }, [user, authLoading, router]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />

      <main className="page-bg" style={{ flex: 1, padding: "48px 24px 64px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>

          <div style={{ marginBottom: "40px" }}>
            <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "clamp(1.8rem, 4vw, 2.4rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
              Your Medications
            </h1>
            {!loading && medications.length > 0 && (
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", fontWeight: 500 }}>
                {medications.length} medication{medications.length !== 1 ? "s" : ""} on record
              </p>
            )}
          </div>

          {(loading || authLoading) && (
            <div style={{ textAlign: "center", padding: "64px 0" }}>
              <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem", fontWeight: 500 }}>
                Loading your medications...
              </p>
              <div style={{ marginTop: "20px", display: "flex", gap: "8px", justifyContent: "center" }}>
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}

          {error && !loading && (
            <div style={{ backgroundColor: "#FFF5F5", border: "1px solid #FEB2B2", borderRadius: "var(--radius)", padding: "24px", color: "#C53030", fontSize: "1rem", fontWeight: 600 }}>
              {error}
            </div>
          )}

          {!loading && !error && medications.length === 0 && (
            <div style={{ backgroundColor: "var(--card-bg)", borderRadius: "12px", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <EmptyState />
            </div>
          )}

          {!loading && !error && medications.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {medications.map((med) => (
                <div key={med.id} className="animate-fade-up">
                  <MedicationCard medication={med} showConfirmation={false} />
                </div>
              ))}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
