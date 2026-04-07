// app/page.tsx  (route: "/")
//
// This is the home page and the core screen of MediBuddy.
// Its single job: let the user upload a photo of a medication label and
// show them the AI-extracted information.
//
// STATE MACHINE OVERVIEW
// ----------------------
// The page moves through four states, each with its own UI:
//   "idle"     → Upload area is shown, waiting for user to pick a file
//   "ready"    → File is selected, "Analyze" button is shown
//   "loading"  → API call is in-flight, spinner is shown
//   "result"   → MedicationCard is shown with the extracted data

"use client"; // Required — this component uses useState, useEffect, and event handlers

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import MedicationCard, { type MedicationRecord } from "@/components/MedicationCard";
import { useUser } from "@/lib/auth";

// ─── Upload Cloud Icon ────────────────────────────────────────────────────────
function UploadIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="28" cy="28" r="28" fill="#EBF3FD" />
      <path
        d="M28 36V22M28 22l-6 6M28 22l6 6"
        stroke="#1E6FD9"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 38h16"
        stroke="#1E6FD9"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Three-dot loading indicator ──────────────────────────────────────────────
function LoadingDots() {
  return (
    <div style={{ display: "flex", gap: "8px", justifyContent: "center", padding: "8px 0" }}>
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

// ─── Spinning icon for the loading state ──────────────────────────────────────
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin-slow"
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="20" stroke="#EBF3FD" strokeWidth="4" />
      <path
        d="M24 4 A20 20 0 0 1 44 24"
        stroke="#1E6FD9"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Page Component ────────────────────────────────────────────────────────────
export default function HomePage() {
  // WHAT IS useRef?
  // useRef lets us directly reference a DOM element — in this case the hidden
  // <input type="file"> element. We use it to programmatically open the file
  // picker when the user clicks the upload zone, so the upload zone can look
  // however we want instead of being a browser-default file input.
  const fileInputRef = useRef<HTMLInputElement>(null);

  type PageState = "idle" | "ready" | "loading" | "result" | "error";
  const [pageState, setPageState]           = useState<PageState>("idle");
  const [selectedFile, setSelectedFile]     = useState<File | null>(null);
  const [previewUrl, setPreviewUrl]         = useState<string | null>(null);
  const [result, setResult]                 = useState<MedicationRecord | null>(null);
  const [errorMessage, setErrorMessage]     = useState<string>("");

  // useUser() gives us the current session, which contains the access_token.
  // We need the access_token to authenticate our API call (see the route handler).
  const { session, loading: authLoading } = useUser();
  const router = useRouter();

  // ── File Selection ───────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPageState("ready");

    // Create a temporary URL to preview the image in the browser.
    // URL.createObjectURL() generates a local blob URL that only exists
    // in this browser tab — no upload happens yet.
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }

  function handleDropZoneClick() {
    // Programmatically click the hidden file input to open the OS file picker
    fileInputRef.current?.click();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); // Prevent browser from opening the file directly
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please drop an image file (JPG, PNG, or WEBP).");
      setPageState("error");
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPageState("ready");
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); // Required for the drop event to fire
  }

  function handleReset() {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setErrorMessage("");
    setPageState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── API Call ─────────────────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!selectedFile) return;

    // If the user isn't logged in, send them to the auth page
    if (!session) {
      router.push("/auth");
      return;
    }

    setPageState("loading");
    setErrorMessage("");

    // WHAT IS FormData?
    // -----------------
    // FormData is a browser-native way to package a file (binary data) + any other
    // fields into a single HTTP request. Regular JSON can only hold text — you'd need
    // to base64-encode the image first, which inflates its size by ~33% and makes the
    // code more complex. FormData handles binary natively; the browser serializes it
    // as "multipart/form-data" automatically when passed to fetch().
    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      const response = await fetch("/api/analyze-medication", {
        method: "POST",
        // We pass the JWT access token in the Authorization header.
        // The API route reads this to verify WHO is making the request.
        // Never trust data from the request body for identity — only the signed JWT.
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
        // NOTE: Do NOT set Content-Type here. When you pass FormData to fetch(),
        // the browser sets Content-Type: multipart/form-data with the correct
        // boundary string automatically. Setting it manually breaks the parse.
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }

      setResult(data.medication as MedicationRecord);
      setPageState("result");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMessage(msg);
      setPageState("error");
    }
  }

  // ── Redirect unauthenticated users ──────────────────────────────────────
  //
  // WHY THIS MUST BE A useEffect, NOT AN INLINE if() DURING RENDER
  // ---------------------------------------------------------------
  // React's render function is meant to be a pure calculation: given the current
  // state and props, return some JSX to display. It must have no side effects.
  //
  // Calling router.push() directly in the render body IS a side effect — it
  // triggers a navigation while React is still in the middle of building the
  // component tree. React detects this and throws:
  //   "Cannot update a component (Router) while rendering a different component"
  //
  // useEffect runs AFTER React has finished rendering and committed the result
  // to the DOM. At that point it's safe to trigger navigations, fetch data, or
  // update external systems. The dependency array [authLoading, session] means
  // React re-runs this effect whenever either value changes — so it fires both
  // on initial mount and whenever the auth state resolves.
  useEffect(() => {
    if (!authLoading && !session) {
      router.push("/auth");
    }
  }, [authLoading, session, router]);

  // Show nothing while the auth check is still in-flight (avoids a flash of
  // the upload UI before the redirect fires)
  if (authLoading || !session) return null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />

      <main
        className="page-bg"
        style={{ flex: 1, padding: "48px 24px 64px" }}
      >
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>

          {/* ── Page Heading ─────────────────────────────────────────────── */}
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h1
              style={{
                fontFamily: "var(--font-lora)",
                fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
                fontWeight: 700,
                color: "var(--text-primary)",
                lineHeight: 1.25,
                marginBottom: "12px",
              }}
            >
              What medication would you
              <br />
              like to understand?
            </h1>
            <p
              style={{
                fontSize: "1.1rem",
                color: "var(--text-secondary)",
                fontWeight: 500,
                maxWidth: "520px",
                margin: "0 auto",
              }}
            >
              Upload a clear photo of your pill bottle or prescription label.
              We&apos;ll explain it in plain English.
            </p>
          </div>

          {/* ── Upload Zone ──────────────────────────────────────────────── */}
          {(pageState === "idle" || pageState === "ready") && (
            <div style={{ marginBottom: "32px" }}>
              {/* Hidden real file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                style={{ display: "none" }}
                aria-label="Choose an image of your medication label"
              />

              {/* Clickable drop zone */}
              <div
                onClick={handleDropZoneClick}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                role="button"
                tabIndex={0}
                aria-label="Click or drag to upload a medication photo"
                onKeyDown={(e) => e.key === "Enter" && handleDropZoneClick()}
                style={{
                  border: `2px dashed ${pageState === "ready" ? "#1E6FD9" : "#CBD5E0"}`,
                  borderRadius: "12px",
                  backgroundColor: pageState === "ready" ? "#EBF3FD" : "var(--card-bg)",
                  padding: "48px 32px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                className="hover:border-[#1E6FD9] hover:bg-[#EBF3FD]"
              >
                {pageState === "ready" && previewUrl ? (
                  // Image preview
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Selected medication label preview"
                      style={{
                        maxHeight: "220px",
                        maxWidth: "100%",
                        borderRadius: "8px",
                        margin: "0 auto 20px",
                        display: "block",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                        objectFit: "contain",
                      }}
                    />
                    <p
                      style={{
                        color: "var(--blue-primary)",
                        fontWeight: 700,
                        fontSize: "1rem",
                        marginBottom: "4px",
                      }}
                    >
                      {selectedFile?.name}
                    </p>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                      Click to choose a different photo
                    </p>
                  </div>
                ) : (
                  // Default upload prompt
                  <div>
                    <div className="animate-pulse-ring" style={{ display: "inline-block", marginBottom: "20px" }}>
                      <UploadIcon size={64} />
                    </div>
                    <p
                      style={{
                        fontSize: "1.15rem",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        marginBottom: "8px",
                      }}
                    >
                      Upload a photo of your pill bottle or prescription
                    </p>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                      Click here, or drag and drop — JPG, PNG, or WEBP
                    </p>
                  </div>
                )}
              </div>

              {/* Analyze button — only shown when a file is selected */}
              {pageState === "ready" && (
                <button
                  onClick={handleAnalyze}
                  className="w-full text-white font-bold rounded-lg"
                  style={{
                    marginTop: "20px",
                    padding: "18px",
                    backgroundColor: "#1E6FD9",   // Hard-coded — CSS vars can fail before stylesheet loads
                    color: "#FFFFFF",              // Explicit on every primary button, never inherited
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    letterSpacing: "0.01em",
                    transition: "background-color 0.15s",
                    display: "block",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1558B0")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1E6FD9")}
                >
                  Analyze Medication
                </button>
              )}
            </div>
          )}

          {/* ── Loading State ─────────────────────────────────────────────── */}
          {pageState === "loading" && (
            <div
              style={{
                backgroundColor: "var(--card-bg)",
                borderRadius: "12px",
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border)",
                padding: "56px 32px",
                textAlign: "center",
              }}
            >
              <SpinnerIcon />
              <p
                style={{
                  fontFamily: "var(--font-lora)",
                  fontSize: "1.4rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  margin: "24px 0 8px",
                }}
              >
                Analyzing your medication...
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", marginBottom: "24px" }}>
                Reading the label and preparing your explanation
              </p>
              <LoadingDots />
            </div>
          )}

          {/* ── Error State ────────────────────────────────────────────────── */}
          {pageState === "error" && (
            <div
              style={{
                backgroundColor: "#FFF5F5",
                border: "1px solid #FEB2B2",
                borderRadius: "12px",
                padding: "32px",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              <p
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "#C53030",
                  marginBottom: "12px",
                }}
              >
                Something went wrong
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", marginBottom: "24px" }}>
                {errorMessage || "Please try again. If the problem continues, check your internet connection."}
              </p>
              <button
                onClick={handleReset}
                className="text-white font-bold rounded-lg"
                style={{
                  padding: "14px 32px",
                  backgroundColor: "#1E6FD9",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "1rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1558B0")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1E6FD9")}
              >
                Try Again
              </button>
            </div>
          )}

          {/* ── Result State ──────────────────────────────────────────────── */}
          {pageState === "result" && result && (
            <div className="animate-fade-up">
              <MedicationCard medication={result} showConfirmation={true} />

              <div style={{ marginTop: "24px", textAlign: "center" }}>
                <button
                  onClick={handleReset}
                  style={{
                    padding: "14px 32px",
                    backgroundColor: "transparent",
                    color: "#1E6FD9",              // Hex — not CSS var, so always visible
                    border: "2px solid #1E6FD9",   // Hex — same reason
                    borderRadius: "8px",
                    fontSize: "1rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#1E6FD9";
                    e.currentTarget.style.color = "#FFFFFF";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#1E6FD9";
                  }}
                >
                  Analyze Another Medication
                </button>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
