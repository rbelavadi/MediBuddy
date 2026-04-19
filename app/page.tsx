"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import MedicationCard, { type MedicationRecord } from "@/components/MedicationCard";
import { useUser } from "@/lib/auth";

function UploadIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <circle cx="28" cy="28" r="28" fill="#EBF3FD" />
      <path d="M28 36V22M28 22l-6 6M28 22l6 6" stroke="#1E6FD9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 38h16" stroke="#1E6FD9" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function LoadingDots() {
  return (
    <div style={{ display: "flex", gap: "8px", justifyContent: "center", padding: "8px 0" }}>
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin-slow" width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="20" stroke="#EBF3FD" strokeWidth="4" />
      <path d="M24 4 A20 20 0 0 1 44 24" stroke="#1E6FD9" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

type PageState = "idle" | "ready" | "loading" | "result" | "error";

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pageState, setPageState]       = useState<PageState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null);
  const [result, setResult]             = useState<MedicationRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const { session, loading: authLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !session) {
      router.push("/auth");
    }
  }, [authLoading, session, router]);

  if (authLoading || !session) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPageState("ready");
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleDropZoneClick() {
    fileInputRef.current?.click();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
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
    e.preventDefault();
  }

  function handleReset() {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setErrorMessage("");
    setPageState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAnalyze() {
    if (!selectedFile || !session) return;
    setPageState("loading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      const response = await fetch("/api/analyze-medication", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
        // Do NOT set Content-Type — fetch sets it automatically with the correct boundary for FormData.
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");

      setResult(data.medication as MedicationRecord);
      setPageState("result");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPageState("error");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />

      <main className="page-bg" style={{ flex: 1, padding: "48px 24px 64px" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>

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
            <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", fontWeight: 500, maxWidth: "520px", margin: "0 auto" }}>
              Upload a clear photo of your pill bottle or prescription label.
              We&apos;ll explain it in plain English.
            </p>
          </div>

          {(pageState === "idle" || pageState === "ready") && (
            <div style={{ marginBottom: "32px" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                style={{ display: "none" }}
                aria-label="Choose an image of your medication label"
              />

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
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Selected medication label preview"
                      style={{ maxHeight: "220px", maxWidth: "100%", borderRadius: "8px", margin: "0 auto 20px", display: "block", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", objectFit: "contain" }}
                    />
                    <p style={{ color: "var(--blue-primary)", fontWeight: 700, fontSize: "1rem", marginBottom: "4px" }}>
                      {selectedFile?.name}
                    </p>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                      Click to choose a different photo
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="animate-pulse-ring" style={{ display: "inline-block", marginBottom: "20px" }}>
                      <UploadIcon size={64} />
                    </div>
                    <p style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                      Upload a photo of your pill bottle or prescription
                    </p>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                      Click here, or drag and drop — JPG, PNG, or WEBP
                    </p>
                  </div>
                )}
              </div>

              {pageState === "ready" && (
                <button
                  onClick={handleAnalyze}
                  className="w-full text-white font-bold rounded-lg"
                  style={{
                    marginTop: "20px",
                    padding: "18px",
                    backgroundColor: "#1E6FD9",
                    color: "#FFFFFF",
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
              <p style={{ fontFamily: "var(--font-lora)", fontSize: "1.4rem", fontWeight: 600, color: "var(--text-primary)", margin: "24px 0 8px" }}>
                Analyzing your medication...
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", marginBottom: "24px" }}>
                Reading the label and preparing your explanation
              </p>
              <LoadingDots />
            </div>
          )}

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
              <p style={{ fontSize: "1.15rem", fontWeight: 700, color: "#C53030", marginBottom: "12px" }}>
                Something went wrong
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "1rem", marginBottom: "24px" }}>
                {errorMessage || "Please try again. If the problem continues, check your internet connection."}
              </p>
              <button
                onClick={handleReset}
                className="text-white font-bold rounded-lg"
                style={{ padding: "14px 32px", backgroundColor: "#1E6FD9", color: "#FFFFFF", border: "none", borderRadius: "8px", fontSize: "1rem", fontWeight: 700, cursor: "pointer", transition: "background-color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1558B0")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1E6FD9")}
              >
                Try Again
              </button>
            </div>
          )}

          {pageState === "result" && result && (
            <div className="animate-fade-up">
              <MedicationCard medication={result} showConfirmation={true} />
              <div style={{ marginTop: "24px", textAlign: "center" }}>
                <button
                  onClick={handleReset}
                  style={{
                    padding: "14px 32px",
                    backgroundColor: "transparent",
                    color: "#1E6FD9",
                    border: "2px solid #1E6FD9",
                    borderRadius: "8px",
                    fontSize: "1rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1E6FD9"; e.currentTarget.style.color = "#FFFFFF"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#1E6FD9"; }}
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
