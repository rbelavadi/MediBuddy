// app/layout.tsx
//
// The root layout is the outermost shell for every page in the app.
// In Next.js App Router, layout.tsx wraps all child routes — you define
// things here that should exist on EVERY page: the <html> tag, global fonts,
// global CSS, and site-wide metadata.
//
// FONT CHOICES
// -------------
// - Lora (serif): Used for headings. Warm, trustworthy, associated with health/publishing.
//   It conveys authority without being cold. Excellent at large sizes for older readers.
// - Nunito: Used for body text. Rounded letterforms score highly on readability tests,
//   especially for users with early-stage vision difficulties. Friendly but not childish.
//
// Both are loaded via next/font/google, which self-hosts them — no Google CDN requests
// at runtime. This improves privacy and performance.

import type { Metadata } from "next";
import { Lora, Nunito } from "next/font/google";
import "./globals.css";

// Lora: display font for headings only (we pass the CSS variable to globals.css)
const lora = Lora({
  weight: ["400", "600", "700"],
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap", // Show fallback font immediately; swap to Lora when loaded
});

// Nunito: body font for all other text
const nunito = Nunito({
  weight: ["500", "600", "700", "800"],
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MediBuddy — Your medications, explained clearly.",
  description:
    "Upload a photo of your prescription or pill bottle and get a plain-language explanation of what it is, how to take it, and what to watch for.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // We attach both font CSS variables to the <html> element so that globals.css
      // can reference them via var(--font-lora) and var(--font-nunito) anywhere.
      className={`${lora.variable} ${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
