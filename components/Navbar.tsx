"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function MedicalCrossIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="10" y="2"  width="8" height="24" rx="2" fill="#1E6FD9" />
      <rect x="2"  y="10" width="24" height="8"  rx="2" fill="#1E6FD9" />
    </svg>
  );
}

export default function Navbar() {
  const { user, loading } = useUser();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  return (
    <nav
      style={{
        backgroundColor: "var(--card-bg)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}
      className="sticky top-0 z-50"
    >
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3" aria-label="MediBuddy home">
          <MedicalCrossIcon />
          <span
            style={{
              fontFamily: "var(--font-lora)",
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            MediBuddy
          </span>
        </Link>

        <div className="flex items-center gap-6">
          <Link
            href="/"
            style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none", padding: "6px 4px" }}
            className="hover:text-[#1E6FD9] transition-colors duration-150"
          >
            Home
          </Link>

          <Link
            href="/medications"
            style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none", padding: "6px 4px" }}
            className="hover:text-[#1E6FD9] transition-colors duration-150"
          >
            My Medications
          </Link>

          {!loading && user && (
            <div className="flex items-center gap-4 pl-4" style={{ borderLeft: "1px solid var(--border)" }}>
              <span
                style={{
                  fontSize: "0.82rem",
                  color: "var(--text-secondary)",
                  fontWeight: 500,
                  maxWidth: "180px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={user.email ?? ""}
              >
                {user.email}
              </span>

              <button
                onClick={handleSignOut}
                style={{
                  backgroundColor: "transparent",
                  border: "2px solid #CBD5E0",
                  borderRadius: "8px",
                  color: "#4A5568",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  padding: "8px 16px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#1E6FD9";
                  e.currentTarget.style.color = "#1E6FD9";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#CBD5E0";
                  e.currentTarget.style.color = "#4A5568";
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
