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

3. **Redaction level (Tier 2, now live):** Microsoft Presidio scans the extracted label text and replaces names, addresses, dates of birth, phone numbers, SSNs and prescriber licence numbers with tags like `[PERSON]` and `[DATE]` **before anything is written to the database**. Only the redacted version is stored — the original string exists in memory for the duration of one request and is never inserted, logged, or returned.

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
         ├─► 2. Send image to Claude Haiku (VISION — extraction only)
         │         └── Extracts: name, dosage, instructions, raw label text
         │               Also extracts purpose + side effects, which serve as
         │               the FALLBACK data source in step 5
         │               PII is stripped from all fields by prompt instruction
         │
         ├─► 3. RxNorm API lookup (NIH)
         │         └── Normalize drug name → RxCUI code
         │               (handles global brand names: Crocin → acetaminophen)
         │               Failure is non-fatal → saved as null
         │
         ├─► 4. Python service: POST /redact  ◄── Microsoft Presidio
         │         └── NLP detects PHI the prompt missed → replaced with
         │               [PERSON] / [DATE] / [LOCATION] tags
         │               ONLY the redacted text is ever stored
         │               ⚠ If this fails the scan is REFUSED (503) — we never
         │                 fall back to storing un-redacted text
         │
         ├─► 5. Python service: POST /dailymed  ◄── FDA label database
         │         └── RxCUI → ingredient (RxNav) → official FDA label
         │               Extracts purpose, dosage, side effects, warnings
         │               verified: true  → use FDA data, set dailymed_verified
         │               verified: false → fall back to Claude's extraction
         │               Fallback is per-field, not all-or-nothing
         │
         ├─► 6. Send to Claude Haiku (TEXT — explanation only)
         │         └── Translates FDA clinical language into plain, warm English
         │               Told explicitly: explain, do not extract; use only the
         │               data provided, never your own knowledge
         │
         ├─► 7. Insert to Supabase (Postgres)
         │         └── user_id from verified JWT — never from client
         │               raw_label_text = Presidio output only
         │               dailymed_verified drives the "FDA Verified" badge
         │               image_url = null (still deferred)
         │               RLS enforces row-level isolation
         │
         └─► 8. Return structured record to frontend
                   └── MedicationCard renders:
                         • What it's for (purpose)
                         • How to take it (dosage + instructions)
                         • Side effects to watch for
                         • "FDA Verified" badge, when earned
                         • "Added to your list" confirmation
```

### The "FDA Verified" badge

When a medication card shows a **✓ FDA Verified** badge, it means the purpose, dosage and
side effects on that card were taken from the official FDA drug label via DailyMed, then
translated into plain language by Claude. The facts come from the FDA; only the wording is
AI-generated.

When the badge is **absent**, the information came from AI vision reading the bottle alone.
That happens routinely and is not an error — DailyMed only covers drugs marketed in the
United States, so internationally prescribed medications (and compounded preparations)
legitimately have no entry. MediBuddy explicitly targets a global user base, so this is an
expected outcome for a meaningful share of users, not an edge case.

Two rules govern the badge:

1. **It is never shown for model-generated content.** Implying FDA backing for text a
   model produced would be the most damaging thing this app could do.
2. **Its absence is quiet, not a warning.** The card is still accurate and useful. Flagging
   provenance in alarming language to an 80-year-old would cost more than it informs.

---

## Tech Stack

| Technology | Why |
|---|---|
| **Next.js 14 (App Router)** | Full-stack React framework — API routes and pages in one repo, no separate backend needed at this scale |
| **TypeScript** | Catches shape mismatches in AI API responses at compile time, not at runtime in production |
| **Tailwind CSS** | Utility-first styling enables fast iteration on accessible, large-text UIs without context-switching to stylesheets |
| **Supabase** | Postgres + Auth + Storage in one hosted service — eliminates managing three separate infrastructure pieces |
| **Claude Haiku (Anthropic)** | Fastest, most cost-efficient Claude model with vision capability — sufficient for structured extraction from label images |
| **RxNorm API (NIH)** | Free, authoritative drug identifier system that normalizes international brand names to canonical codes. The RxCUI it returns is also the join key into DailyMed — without it, a bottle labelled "Crocin" could never be matched to a US federal drug label |
| **DailyMed API (FDA)** | The FDA's official repository of drug labels — the same package-insert text a pharmacist reads. Without it, every word in the app is model output, which for a medication app used by elderly patients is the highest-consequence failure mode in the product. Free, no API key |
| **Microsoft Presidio** | Open-source PHI detection and redaction. Chosen over regular expressions because most PHI on a prescription label is *contextual*, not patterned: "Patterson" is a person in `Patient: Mary Patterson` and a place in `Patterson Pharmacy, Main St`. A regex sees the same nine characters in both; a trained NER model tells them apart |
| **spaCy (`en_core_web_lg`)** | The NER model Presidio delegates to for anything name- or place-shaped. Required, not optional — without it Presidio still returns HTTP 200 and simply finds far less PHI, which is the most dangerous failure mode a privacy tool can have. The large model is used because accuracy drops sharply on short fragmentary text, and labels are exactly that |
| **FastAPI + Python** | Presidio and spaCy are Python-only, so PHI redaction cannot run inside the Next.js process. The cost is a second process to run and deploy; we accept it because the alternative is regex-based PHI detection, which cannot work |

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
- ✅ **Microsoft Presidio PHI redaction** — only redacted text is ever stored; a redaction
  failure refuses the save rather than falling back
- ✅ **DailyMed integration** — explanations grounded in official FDA label data, with a
  per-field fallback to AI extraction and an "FDA Verified" badge when earned
- ✅ **Two-stage Claude pipeline** — extraction and explanation separated into distinct calls

---

## Roadmap — Tier 2

- [ ] **Image storage** — store redacted prescription photos in Supabase Storage (now that Presidio is in place)
- [ ] **Chat history persistence** — save conversations to Postgres so they survive a refresh
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
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade not null,
  medication_name   text not null,
  rxnorm_code       text,
  purpose           text,
  dosage            text,
  instructions      text,
  side_effects      text[],
  raw_label_text    text,          -- Presidio-redacted text ONLY; never raw label text
  image_url         text,
  dailymed_verified boolean default false,  -- drives the "FDA Verified" badge
  created_at        timestamptz default now() not null
);

alter table medications enable row level security;

create policy "Users can manage their own medications"
  on medications for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

> **Already have the table from Tier 1?** Add the new column rather than recreating it:
>
> ```sql
> alter table medications add column dailymed_verified boolean default false;
> ```
>
> Without this column every scan will fail at the insert step.

### 3. Set up environment variables

Create a `.env.local` file in the project root:

```bash
# Supabase — Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Anthropic — console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-...

# Python microservice (Presidio PHI redaction + DailyMed lookup)
# Local default; becomes the deployed service URL in production
PYTHON_SERVICE_URL=http://localhost:8000
```

**Where to find these values:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase Dashboard → Project Settings → API → Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Dashboard → Project Settings → API → Project API Keys → `anon / public`
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
- `PYTHON_SERVICE_URL` — `http://localhost:8000` for local development (see step 4)

> **Note:** The Supabase keys are safe to expose in the browser (they're prefixed `NEXT_PUBLIC_`). The Anthropic key must never be exposed — keep it server-side only and never add `NEXT_PUBLIC_` to it. `PYTHON_SERVICE_URL` is also deliberately un-prefixed: that service receives un-redacted label text, so it must only ever be reached from the server.

### 4. Set up the Python microservice

MediBuddy runs **two processes**. The Next.js app handles the UI and the Claude calls; a
small FastAPI service handles PHI redaction (Presidio) and FDA label lookups (DailyMed),
because both of those depend on Python-only libraries. **A scan will fail without it** —
the redaction step is intentionally not optional.

Full instructions are in [`python-service/README.md`](python-service/README.md). The short version:

```bash
cd python-service

# Use Python 3.9–3.12. spaCy 3.8 has no wheels for 3.13+, so if `python` on your
# machine is newer than 3.12, name the version explicitly:
py -3.12 -m venv venv          # Windows
# python3.12 -m venv venv      # macOS / Linux

source venv/Scripts/activate   # Windows (Git Bash); PowerShell: venv\Scripts\Activate.ps1
# source venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
python -m spacy download en_core_web_lg   # ~400MB, REQUIRED — see note below

uvicorn main:app --reload --port 8000
```

> **Do not skip the spaCy model download.** Presidio is a framework, not a model — it
> delegates name and place detection to spaCy's NER. Without the model it still starts and
> still returns HTTP 200; it just finds far less PHI. Silent degradation is the worst
> possible failure mode for a privacy tool.

Verify it is up:

```bash
curl http://localhost:8000/health
```

### 5. Run the development server

In a **second terminal**, with the Python service still running:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create an account at `/auth`, then upload a photo of any medication label on the home page.

> **Both processes must be running.** If you see "We could not safely process your label
> right now", the Python service on port 8000 is not reachable — that error is the
> redaction step correctly refusing to save anything rather than storing un-redacted text.

---

## Security Notes

- All API routes verify the user's JWT server-side before processing any request
- User ID is always sourced from the verified JWT — never from client-supplied data
- Postgres RLS policies enforce row isolation at the database level as a second layer
- `.env.local` is excluded from git by `.gitignore` — never commit API keys
- Raw prescription images are still not stored (Presidio is now in place; image storage is the next step)
- `raw_label_text` contains Presidio-redacted text only. The un-redacted string never reaches the database, the logs, or the client
- Redaction logs record entity **types and counts**, never matched values — logging the detected PHI would defeat the purpose of redacting it
- If the redaction service is unreachable, the scan fails closed (`503`) rather than storing un-redacted text
- The Python service must not be publicly exposed in production — it receives un-redacted label text, so it belongs on a private network behind HTTPS
