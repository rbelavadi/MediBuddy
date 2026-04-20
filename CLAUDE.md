# MediBuddy — Project Memory for Claude Code

## What is MediBuddy?
An AI-powered medication management web app designed for elderly patients.
A user uploads a photo of a pill bottle or prescription label. An AI agent extracts the medication
details and explains them in plain, friendly language: what it's for, correct dosage, side effects,
and when to take it. Over time the app builds a personal health context — tracking all medications,
detecting drug interactions, and eventually adding a voice assistant for hands-free use.

**Target user:** Elderly patients managing multiple medications who may not fully understand
what they're taking or why.

---

## Tech Stack & Rationale

| Technology | Why it was chosen |
|---|---|
| **Next.js 14 (App Router)** | Full-stack React framework; App Router enables server components and API routes in one repo — no separate backend needed for a project this size |
| **TypeScript** | Catches type errors at compile time, especially important when working with AI API responses that can be unpredictable |
| **Tailwind CSS** | Utility-first CSS means fast iteration without context-switching to separate stylesheets; good for accessible, senior-friendly large-text UIs |
| **Supabase** | Postgres database + auth + file storage in one hosted service; eliminates the need to manage three separate infrastructure pieces |
| **Claude Haiku (Anthropic)** | Vision-capable LLM; Haiku is the fastest/cheapest tier — sufficient for extracting structured medication data from an image |
| **RxNorm API** | NIH-maintained drug identifier database; normalizes drug names so we can reliably look up interactions |
| **DailyMed API** | FDA label data source; gives us authoritative dosage and side-effect text |

**Build philosophy:** Learn by building. All code has comments explaining *why*, not just *what*.
Architectural decisions include a brief tradeoff note. Each major chunk ends with a plain-English
summary and one thing to tweak to test understanding.

---

## Top-Level Folder / File Map

```
medibuddy/
├── app/                  # Next.js App Router — every folder here is a route
│   ├── api/
│   │   └── analyze-medication/
│   │       └── route.ts  # POST endpoint: image → Claude Haiku → RxNorm → Supabase insert
│   ├── auth/
│   │   └── page.tsx      # Login + Signup page (toggled on one card)
│   ├── medications/
│   │   └── page.tsx      # Protected list of all user's saved medications
│   ├── layout.tsx        # Root layout: Lora + Nunito fonts, metadata, global CSS
│   ├── page.tsx          # Home: upload zone → loading state → MedicationCard result
│   └── globals.css       # Design system CSS variables, animations, base styles
├── components/           # Shared UI components — reused across multiple pages
│   ├── MedicationCard.tsx # Displays one medication: name, purpose, dosage, side effects
│   └── Navbar.tsx        # Top nav: logo, Home, My Medications, sign out + user email
├── lib/                  # Shared utilities — NOT route-specific, imported by many files
│   ├── supabase.ts       # Singleton Supabase client (one shared DB connection for the whole app)
│   └── auth.ts           # useUser() hook — centralised auth state for all Client Components
├── public/               # Static assets (images, icons) served at "/"
├── .env.local            # Secret keys — never committed to git
├── CLAUDE.md             # This file — persistent AI memory for the project
├── next.config.ts        # Next.js configuration (image domains, env exposure, etc.)
├── tsconfig.json         # TypeScript compiler options; "@/*" alias maps to project root
├── eslint.config.mjs     # ESLint rules (next/core-web-vitals preset)
└── package.json          # Dependencies and npm scripts
```

> **Note:** There is no `src/` directory by design — the App Router convention places `app/`
> at the root, keeping the structure flat and easier to navigate.

---

## Current Build Status

### Tier 1 — Scaffold & Setup (COMPLETE)
- [x] Next.js 14 project initialised (TypeScript, Tailwind, ESLint, App Router)
- [x] `@supabase/supabase-js` and `@anthropic-ai/sdk` installed
- [x] `.env.local` created and filled with real Supabase + Anthropic keys
- [x] `CLAUDE.md` created

### Tier 2 — Auth & Database (IN PROGRESS)
- [x] `lib/supabase.ts` — singleton Supabase client, shared across the app
- [x] `lib/auth.ts` — `useUser()` hook centralising auth state for Client Components
- [x] SQL schema designed for `medications` table (run manually in Supabase dashboard)
- [x] RLS policies designed (run manually in Supabase dashboard)
- [ ] Run the SQL schema in the Supabase SQL editor
- [ ] Verify `medications` table appears in Supabase Table Editor
- [ ] Verify RLS policies appear under Authentication → Policies

**Key decisions made in Tier 2:**
- Singleton pattern for Supabase client — avoids creating a new DB connection on every render
- `NEXT_PUBLIC_` prefix on Supabase keys is intentional and safe; RLS enforces real security
- `useUser()` hook centralises auth to prevent stale state across components
- `"use client"` directive on `auth.ts` because React hooks can't run on the server
- `side_effects` stored as `text[]` (Postgres array) rather than a comma-separated string,
  so we can query individual effects later (e.g., "show all meds with drowsiness")
- `rxnorm_code` is nullable because OCR might fail to find a clean drug name to look up

### Tier 3 — AI Extraction Pipeline (COMPLETE)
- [x] `app/api/analyze-medication/route.ts` — full POST pipeline:
  1. Accepts multipart/form-data image upload
  2. Verifies auth server-side from the Authorization header (never trusts client-supplied user_id)
  3. Converts image to base64, sends to Claude Haiku (claude-haiku-4-5) with vision
  4. Parses structured JSON from Claude's response
  5. Calls RxNorm API to normalize the drug name to a standard rxcui code
  6. Inserts everything into the `medications` table in Supabase
  7. Returns the saved record (with generated id + created_at) to the frontend

**Key decisions made in Tier 3:**
- `image_url` intentionally saved as `null` — image storage deferred until PII redaction
  (Microsoft Presidio) is added in a later tier; storing raw prescription images is a privacy risk
- `raw_label_text` relies on Claude's system prompt to strip PII; Presidio will be a second layer
- RxNorm failure is non-fatal — `rxnorm_code` saved as null; interaction checker (Tier 5) skips those rows
- Claude model: `claude-haiku-4-5` chosen for speed + cost; upgrade to Sonnet if accuracy is insufficient
- Auth is verified by forwarding the browser's `Authorization: Bearer <jwt>` header to the
  Supabase server client — Supabase cryptographically validates the JWT
- FormData (not JSON) used for image upload — binary files can't be sent as JSON without
  base64 encoding, which inflates size by ~33%

### Tier 4 — Frontend UI (COMPLETE)
- [x] `app/globals.css` — full design system (CSS variables, fonts, animations, dot-grid background)
- [x] `app/layout.tsx` — Lora (headings) + Nunito (body) via next/font/google, updated metadata
- [x] `app/auth/page.tsx` — login/signup toggle card, Supabase auth.signInWithPassword + signUp
- [x] `app/page.tsx` — upload page: idle → ready → loading → result/error state machine
- [x] `app/medications/page.tsx` — protected list page, fetches from Supabase, handles empty state
- [x] `components/MedicationCard.tsx` — displays medication with color-coded sections; exports MedicationRecord type
- [x] `components/Navbar.tsx` — sticky top nav, sign out, user email display

**Key design decisions in Tier 4:**
- Fonts: Lora (serif, warm, medical-feel) for headings; Nunito (rounded, highly readable) for body
- Minimum 18px base font size; CTA buttons ≥ 20px — accessibility for elderly users
- Upload zone uses a hidden `<input type="file">` with a custom-styled drop target — better UX
- `useRef` used to programmatically trigger the file picker without a visible file input
- Home page is a state machine (idle/ready/loading/result/error) — one variable drives the whole UI
- `Authorization: Bearer <token>` sent with every API call; never trust client-supplied user_id
- RLS note added to medications page: `.eq("user_id", user.id)` is belt-and-suspenders
- `showConfirmation` prop on MedicationCard controls whether "Added to list" banner appears

### Tier 4.5 — AI Chat Assistant (COMPLETE)
- [x] `app/api/chat/route.ts` — streaming POST endpoint; fetches medications server-side; builds system prompt with full medication context; streams `text_delta` events via `ReadableStream`
- [x] `components/ChatWidget.tsx` — three-state widget: collapsed (floating button) → expanded (400×500 floating window) → fullscreen (fills viewport below navbar); all states share the same conversation history; state controlled by a single `ChatState` enum; `usePathname` resets fullscreen to expanded on navigation; conversation persists across states but resets on page refresh (persistence across refreshes is a Tier 2 item)
- [x] `app/layout.tsx` — `<ChatWidget />` added as global component; renders on every page

**Key decisions made in Tier 4.5:**
- Medications fetched server-side in the API route — AI context must never come from client-supplied data; client could inject fake medication data into the system prompt otherwise
- Full conversation history sent on every request — Claude is stateless between API calls; there is no session or memory on the API side; the client holds history in React state and sends it each time
- Streaming chosen over a single response: elderly users read more slowly; streaming lets them start reading immediately rather than waiting 3–5 seconds for a complete response to appear
- Initial greeting message lives only in client state — it is filtered out before being sent to the API to avoid confusing Claude with a message it didn't generate
- Widget hides itself (`if (loading || !session) return null`) — avoids rendering a broken chat button on the auth page where no session exists yet
- Single `ChatState = "collapsed" | "expanded" | "fullscreen"` enum instead of multiple booleans — mutually exclusive states should be modelled as a union type; multiple booleans allow impossible combinations
- Fullscreen panel: `position: fixed; top: 64px; inset: 0; z-index: 50` — sits below the navbar (z-index 100) and above page content; navbar remains fully clickable
- `usePathname` from `next/navigation` detects route changes; if `chatState === "fullscreen"` when the path changes, it snaps back to `"expanded"` so fullscreen doesn't persist across page navigations
- Conversation persistence across browser refreshes deferred to Tier 2 — plan: save messages to a Supabase table keyed by user_id on each send; rehydrate on mount
- Mobile breakpoint: below 480px, expanded window takes over the full screen (fixed inset: 0) via CSS media query

### Tier 5 — Interaction Checker (NOT STARTED)
Cross-reference all of a user's current medications for known interactions.

**Architectural notes for Tier 5:**
- Use the NLM Drug Interaction API: `https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=<csv>`
- Fetch all `rxnorm_code` values (non-null) for the user, pass as comma-separated RxCUI codes
- API returns interaction pairs with severity levels; surface warnings in a dedicated UI section
- Medications with `rxnorm_code = null` (RxNorm lookup failed at scan time) must be excluded from the check — note to user that those medications could not be checked
- Consider a badge on the Navbar or a dedicated `/interactions` page; avoid alarming language

### Tier 6 — Voice Assistant (NOT STARTED)
Hands-free Q&A about the user's medication list using Claude + Web Speech API.

**Architectural notes for Tier 6:**
- Web Speech API (`SpeechRecognition`) handles speech-to-text in the browser — no external STT service needed for MVP
- Pipe the transcript directly into the existing `ChatWidget` send flow — voice and text share the same `/api/chat` backend
- Text-to-speech for responses: Web Speech API (`SpeechSynthesis`) can read Claude's reply aloud
- Key constraint: `SpeechRecognition` is not supported in Safari on iOS — need a fallback UI notice

---

## Intentionally Left Out (for now)
- **No separate backend server** — Next.js API routes handle all server-side logic
- **No Redux / Zustand** — React state + Supabase subscriptions are sufficient at this scale
- **No Docker / containerisation** — Vercel deployment handles infra; premature for learning stage
- **No payment / subscription layer** — out of scope for current tiers
- **No native mobile app** — responsive web first; PWA is a future option
