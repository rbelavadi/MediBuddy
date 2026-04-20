# MediBuddy

> **Your medications, explained clearly.**

---

## Overview

Elderly patients are routinely prescribed multiple medications — but they often leave the pharmacy without truly understanding what they're taking, why they're taking it, when to take it, or what side effects to watch for. Pill bottles list drug names most people have never heard of. Package inserts are dense and written for clinicians. Online searches return information that is often inaccurate, outdated, or panic-inducing.

**MediBuddy fixes this.**

A user takes a photo of any pill bottle or prescription label. MediBuddy reads the label using AI vision, identifies the medication, and explains it in plain, warm, human language — what the drug does, how and when to take it, and the 3–5 most important side effects to watch for, phrased the way a kind pharmacist would explain them to an 80-year-old patient.

Over time, MediBuddy accumulates a personal health context: a complete list of every medication the user takes, with a drug interaction checker coming in the next release tier.

---

## Why This Exists — Product Thinking

These were deliberate design decisions, not defaults:

**Designed specifically for elderly patients**
Every detail of the UI — 18px minimum font size, high-contrast blues and whites, one primary action per screen, no icon-only buttons, generous spacing — exists because the target user may have reduced vision, reduced fine motor control, and low tolerance for interface complexity. The design is not "accessible" as an afterthought; it is the primary design target.

**Blues and whites color palette**
Color communicates trust. Blue is the dominant color of healthcare: hospitals, pharmacy logos, medical equipment. White communicates cleanliness and clinical precision. This palette was chosen deliberately to feel familiar and trustworthy to someone who has spent time in medical settings — not to be aesthetically interesting.

**Global medication naming via RxNorm normalization**
Medication brand names vary significantly by country. The same molecule is sold as Tylenol in the US, Panadol in Australia and the UK, Crocin in India, and Doliprane in France. RxNorm, maintained by the US National Library of Medicine, normalizes all of these to a single canonical identifier (an RxCUI code). This means MediBuddy works correctly regardless of where the user's prescription was written or filled — a deliberate choice to support a global user base from day one, not as a future enhancement.

**AI explanation grounded in verified drug data**
Claude Haiku reads the label and generates the plain-language explanation. In Tier 2, every explanation will be cross-referenced against DailyMed — the FDA's official drug label database — to ground AI-generated content in verified, authoritative sources. This directly addresses the misinformation problem in online medical content, where the same drug can have wildly different descriptions depending on which website a user finds.

**HIPAA-aware architecture**
Prescription labels contain Protected Health Information (PHI): patient name, date of birth, address, doctor name, prescription number. MediBuddy handles this at two levels:

1. **Database level:** Row Level Security (RLS) is enforced directly in Postgres. Even if the application code has a bug that forgets to filter by user ID, the database itself will refuse to return another user's rows. Security is not just an application concern — it's embedded in the data layer.

2. **Application level:** The API route verifies user identity from a cryptographically signed JWT token issued by Supabase, never from data the client sends. A user cannot claim to be someone else.

In Tier 2, Microsoft Presidio (an open-source NLP tool from Microsoft) will scan all extracted text and automatically redact names, addresses, dates of birth, and other PII before anything is stored.

**Image storage deliberately deferred**
Prescription photos are among the most sensitive documents a person owns. MediBuddy does not store the raw image until Presidio is in place to redact PHI. This is a deliberate architectural decision — not a missing feature, but a privacy-first default. The extracted (and AI-scrubbed) text is stored; the image is not.

**Defense in depth**
Two independent layers of access control run on every request: application-level user filtering in the API route, and database-level RLS policies in Postgres. Neither layer relies on the other being correct. This is the "defense in depth" principle: if one layer fails, the other still protects the user.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY                                │
└─────────────────────────────────────────────────────────────────────┘

  📷 User uploads photo of pill bottle or prescription label
         │
         ▼
  [Next.js API Route: /api/analyze-medication]
         │
         ├─► 1. Verify JWT session server-side (Supabase Auth)
         │         └── Reject if not authenticated
         │
         ├─► 2. Send image to Claude Haiku (vision)
         │         └── System prompt extracts: name, dosage, instructions,
         │               purpose, side effects, raw label text
         │               PII is stripped from all fields by prompt instruction
         │
         ├─► 3. RxNorm API lookup (NIH)
         │         └── Normalize drug name → RxCUI code
         │               (handles global brand names: Crocin → acetaminophen)
         │               Failure is non-fatal → saved as null
         │
         ├─► 4. Insert to Supabase (Postgres)
         │         └── user_id from verified JWT — never from client
         │               image_url = null until Presidio is in place
         │               RLS enforces row-level isolation
         │
         └─► 5. Return structured record to frontend
                   └── MedicationCard renders:
                         • What it's for (purpose)
                         • How to take it (dosage + instructions)
                         • Side effects to watch for
                         • "Added to your list" confirmation
```

---

## Tech Stack

| Technology | Why |
|---|---|
| **Next.js 14 (App Router)** | Full-stack React framework — API routes and pages in one repo, no separate backend needed at this scale |
| **TypeScript** | Catches shape mismatches in AI API responses at compile time, not at runtime in production |
| **Tailwind CSS** | Utility-first styling enables fast iteration on accessible, large-text UIs without context-switching to stylesheets |
| **Supabase** | Postgres + Auth + Storage in one hosted service — eliminates managing three separate infrastructure pieces |
| **Claude Haiku (Anthropic)** | Fastest, most cost-efficient Claude model with vision capability — sufficient for structured extraction from label images |
| **RxNorm API (NIH)** | Free, authoritative drug identifier system that normalizes international brand names to canonical codes for interaction checking |
| **DailyMed API (FDA)** | *(Tier 2)* Official FDA drug label database — grounds AI explanations in verified sources |
| **Microsoft Presidio** | *(Tier 2)* Open-source NLP PII detection and redaction — scrubs names, addresses, dates before storage |

---

## How It Works — Chat Assistant

Once a user has uploaded their medications, a floating **Ask about your medications** button appears on every page. This opens a chat window powered by Claude Haiku with full knowledge of the user's personal medication list.

```
  💬 User types a question: "Can I take ibuprofen with my heart medication?"
         │
         ▼
  [Next.js API Route: /api/chat]
         │
         ├─► 1. Verify JWT session (same as analyze route)
         │
         ├─► 2. Fetch user's full medication list from Supabase (server-side)
         │         └── Never use client-supplied medication data — AI context
         │               must come from the verified database record
         │
         ├─► 3. Build system prompt with medication context injected
         │         └── Claude knows: medication name, dosage, purpose,
         │               instructions, side effects, RxNorm code
         │               Role: warm, patient pharmacist for elderly users
         │
         ├─► 4. Call anthropic.messages.stream() with full conversation history
         │         └── Claude has no memory between API calls — the full
         │               history is sent on every request to simulate continuity
         │
         └─► 5. Stream text_delta events back to ChatWidget
                   └── Text appears word-by-word while Claude is still typing
```

**Why streaming matters for this user group:** An 80-year-old reading at a slower pace benefits from seeing text appear progressively — they can start reading while Claude is still generating the answer, rather than staring at a loading spinner for 3–5 seconds.

---

## Current Status — Tiers 1 & 4 Complete

The core pipeline is built and working end-to-end:

- ✅ User authentication (email + password via Supabase Auth)
- ✅ Image upload with drag-and-drop support
- ✅ Claude Haiku vision extraction with PII-stripping prompt
- ✅ RxNorm drug name normalization
- ✅ Structured medication data saved to Postgres with RLS
- ✅ Plain-language medication explanation displayed (MedicationCard)
- ✅ Personal medication list (`/medications`)
- ✅ Row Level Security — users can only access their own records
- ✅ Server-side auth verification on every API call
- ✅ Floating AI chat assistant — answers questions about the user's medication list

---

## Roadmap — Tier 2

- [ ] **DailyMed integration** — fetch official FDA label data for every medication; use it to validate and enrich the AI explanation
- [ ] **Microsoft Presidio PII redaction** — scan extracted text before storage; redact patient name, DOB, address, doctor name, prescription number
- [ ] **Image storage** — store redacted prescription photos in Supabase Storage (after Presidio is in place)
- [ ] **Drug interaction detection** — cross-reference all of a user's RxCUI codes against the NLM interaction API; surface warnings clearly
- [ ] **Caregiver view** — allow a family member or caregiver to view (read-only) a patient's medication list with explicit consent
- [ ] **Voice assistant** — hands-free Q&A about the user's medication list using Claude + Web Speech API

---

## Running Locally

### 1. Clone and install

```bash
git clone <your-repo-url>
cd medibuddy
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In the SQL Editor, run the schema below to create the `medications` table and RLS policies:

```sql
create table medications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  medication_name text not null,
  rxnorm_code     text,
  purpose         text,
  dosage          text,
  instructions    text,
  side_effects    text[],
  raw_label_text  text,
  image_url       text,
  created_at      timestamptz default now() not null
);

alter table medications enable row level security;

create policy "Users can manage their own medications"
  on medications for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

### 3. Set up environment variables

Create a `.env.local` file in the project root:

```bash
# Supabase — Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Anthropic — console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-...
```

**Where to find these values:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase Dashboard → Project Settings → API → Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Dashboard → Project Settings → API → Project API Keys → `anon / public`
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key

> **Note:** The Supabase keys are safe to expose in the browser (they're prefixed `NEXT_PUBLIC_`). The Anthropic key must never be exposed — keep it server-side only and never add `NEXT_PUBLIC_` to it.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account at `/auth`, then upload a photo of any medication label on the home page.

---

## Security Notes

- All API routes verify the user's JWT server-side before processing any request
- User ID is always sourced from the verified JWT — never from client-supplied data
- Postgres RLS policies enforce row isolation at the database level as a second layer
- `.env.local` is excluded from git by `.gitignore` — never commit API keys
- Raw prescription images are not stored until Presidio PII redaction is implemented (Tier 2)
