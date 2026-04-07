// components/Navbar.tsx
//
// The Navbar is a Client Component because it uses the useUser() hook,
// which relies on React's useState and useEffect. In Next.js App Router,
// anything that uses React hooks MUST have the "use client" directive.
// Server Components (the default) can't hold state or run browser-side code.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// ─── Cross SVG icon (the MediBuddy logo mark) ────────────────────────────────
// A simple medical cross rendered as inline SVG — no external image file needed.
// We keep it small and clean; the wordmark text beside it carries the brand weight.
function MedicalCrossIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <rect x="10" y="2"  width="8" height="24" rx="2" fill="#1E6FD9" />
      <rect x="2"  y="10" width="24" height="8"  rx="2" fill="#1E6FD9" />
    </svg>
  );
}

export default function Navbar() {
  // useUser() is defined in lib/auth.ts.
  // It returns:
  //   user    — the logged-in User object from Supabase, or null
  //   session — the full session (contains the JWT access token), or null
  //   loading — true while we're checking localStorage for a saved session
  //
  // WHY THIS HOOK EXISTS HERE RATHER THAN CALLING supabase.auth DIRECTLY:
  // By centralising all auth state in one hook, every component that calls
  // useUser() gets the same live session object. If one component logs the
  // user out, all other components automatically see user = null.
  const { user, loading } = useUser();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    // After sign-out, redirect to the auth page.
    // router.push() is the Next.js way to navigate programmatically (no full page reload).
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
        {/* ── Logo / Wordmark ─────────────────────────────────────────────── */}
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="MediBuddy home"
        >
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

        {/* ── Navigation Links ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--text-secondary)",
              textDecoration: "none",
              padding: "6px 4px",
            }}
            className="hover:text-[#1E6FD9] transition-colors duration-150"
          >
            Home
          </Link>

          <Link
            href="/medications"
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--text-secondary)",
              textDecoration: "none",
              padding: "6px 4px",
            }}
            className="hover:text-[#1E6FD9] transition-colors duration-150"
          >
            My Medications
          </Link>

          {/* ── Sign Out / User Info ─────────────────────────────────────── */}
          {!loading && user && (
            <div className="flex items-center gap-4 pl-4" style={{ borderLeft: "1px solid var(--border)" }}>
              {/* Show the user's email so they know whose account they're in */}
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
                  border: "2px solid #CBD5E0",  // Hex — CSS vars can fail before stylesheet loads
                  borderRadius: "8px",
                  color: "#4A5568",             // Hex — same reason; never rely on inheritance
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
