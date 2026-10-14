# MediBuddy Python Microservice

PHI redaction (Microsoft Presidio) and FDA drug label lookup (DailyMed) for MediBuddy.

The Next.js app calls this service during every medication scan. It runs as a **separate
process on port 8000** — see "Why a separate service?" at the bottom for the reasoning.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/redact` | Detect and replace PHI in raw extracted label text |
| `POST` | `/dailymed` | Look up official FDA label data by RxNorm code |
| `GET` | `/health` | Liveness check — confirms the service and Presidio loaded |

Interactive API docs (FastAPI generates these for free): <http://localhost:8000/docs>

### `POST /redact`

```jsonc
// Request
{ "text": "Patient: Mary Patterson  DOB 04/12/1941  Lisinopril 10mg  Dr. Chen 555-0142" }

// Response
{
  "redacted_text": "Patient: [PERSON] DOB [DATE] Lisinopril 10mg Dr. [PERSON] [PHONE]",
  "entities_found": [
    { "entity_type": "PERSON", "start": 9, "end": 23, "score": 0.85 },
    { "entity_type": "DATE_TIME", "start": 29, "end": 39, "score": 0.95 }
  ]
}
```

`entities_found` deliberately reports **types and offsets only, never the matched text** —
logging the detected value would write the PHI straight into our logs.

### `POST /dailymed`

```jsonc
// Request
{ "rxnorm_code": "29046" }

// Response when an FDA label is found
{
  "purpose": "Lisinopril is indicated for the treatment of hypertension...",
  "dosage": "The usual initial dose is 10 mg once daily...",
  "side_effects": ["Headache", "Dizziness", "Cough", "Fatigue"],
  "warnings": "Discontinue as soon as possible when pregnancy is detected...",
  "verified": true,
  "source_setid": "00b266d9-ac4a-e931-e063-6294a90a6a0b",
  "ingredient": "lisinopril"
}

// Response when no usable FDA label exists — NOT an error, HTTP 200
{ "verified": false, "ingredient": "lisinopril", "side_effects": [] }
```

`verified: false` is an expected outcome, not a failure. DailyMed only covers drugs
marketed in the US, so internationally prescribed and compounded medications legitimately
have no entry. The caller falls back to Claude's own extraction and omits the
"FDA Verified" badge.

---

## Setup

Run all commands from the `python-service/` directory. **Python 3.9–3.12** (spaCy 3.8 does
not yet publish wheels for 3.13 on all platforms).

### 1. Create a virtual environment

A venv keeps these packages — and the ~560MB spaCy model — isolated from your system
Python, so this project cannot break another one.

```bash
cd python-service
python -m venv venv
```

Activate it:

```bash
# Windows (PowerShell)
venv\Scripts\Activate.ps1

# Windows (Git Bash)
source venv/Scripts/activate

# macOS / Linux
source venv/bin/activate
```

Your prompt should now be prefixed with `(venv)`. If PowerShell blocks the activation
script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and retry.

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Download the spaCy NER model

**This step is required — `pip install` does not do it, and the service will not detect
names or places without it.**

```bash
python -m spacy download en_core_web_lg
```

Presidio is a *framework*, not a model. For anything name- or place-shaped it delegates to
spaCy's Named Entity Recognition model, which is what actually reads context and decides
that "May" is a person in `Dr. May` but a date in `May 3`. Without the model, Presidio
still starts and still returns HTTP 200 — it just finds far less PHI. That silent
degradation is the most dangerous failure mode for a privacy tool, so do not skip it.

We use `en_core_web_lg` (~560MB) rather than `en_core_web_sm` (~12MB) because the small
model's accuracy drops sharply on short, fragmentary text — and prescription labels are
exactly that: scraps and columns, not prose. The download is a one-time cost paid at
install; the model is loaded once at startup, so it does not affect per-request latency.

### 4. Run the service

```bash
uvicorn main:app --reload --port 8000
```

`--reload` restarts on file save (development only — drop it in production).
Startup takes a few seconds while the spaCy model loads into memory.

### 5. Verify it works

```bash
curl http://localhost:8000/health

curl -X POST http://localhost:8000/redact \
  -H "Content-Type: application/json" \
  -d '{"text":"Patient: Mary Patterson, DOB 04/12/1941, Lisinopril 10mg"}'

curl -X POST http://localhost:8000/dailymed \
  -H "Content-Type: application/json" \
  -d '{"rxnorm_code":"29046"}'
```

The Next.js app expects this service at the URL in `PYTHON_SERVICE_URL`
(`http://localhost:8000` locally). **Both processes must be running** — `npm run dev` in
the project root and `uvicorn` here.

---

## Why a separate service?

Presidio is Python-only, and so is spaCy, its NER backend. There is no JavaScript
equivalent of comparable quality. The alternative was re-implementing PHI detection in
TypeScript with regular expressions — which cannot work, because most PHI on a label is
**contextual**, not patterned:

```
"Patient: Mary Patterson"        → Patterson is a PERSON
"Patterson Pharmacy, Main St"    → Patterson is a LOCATION
```

A regex sees the same nine characters in both. A trained NER model reads the surrounding
words and tells them apart. Rebuilding that capability in TypeScript would mean rebuilding
spaCy.

**Tradeoff:** two processes to run and deploy instead of one. We accept that cost because
PHI redaction is a correctness and legal requirement — getting it wrong leaks patient
identity into the database. The DailyMed lookup is bundled into the same service only
because it is also I/O-and-XML-parsing work that would otherwise bloat the Next.js route;
it could have stayed in TypeScript.

---

## Implementation notes

Two things worth knowing if you modify the DailyMed code:

- **`?ingredient=` does not work on the DailyMed v2 API.** It is an unrecognised parameter,
  and the API *ignores* unknown parameters instead of rejecting them — so
  `spls.json?ingredient=acetaminophen` returns HTTP 200 with the entire 159,000-label
  database, starting with antihistamines and hand wipes. A silent wrong answer is worse
  than an error here, because the pipeline would cheerfully attach a random label to a
  patient's medication. The parameters that actually filter are **`rxcui=`** (what we use
  first) and **`drug_name=`** (our fallback, using the ingredient name from RxNav).
- **Label *content* is only available as XML.** `/spls/{setid}.json` returns an empty
  response; the JSON API covers the index (titles, setids, dates), not section bodies.
  So `/spls/{setid}.xml` and HL7 v3 XML parsing are required, not a stylistic choice.

Section names differ between prescription and OTC labels (`INDICATIONS & USAGE SECTION`
vs `OTC - PURPOSE SECTION`), so `SECTION_MAP` in `main.py` lists both for every field and
takes the first one a given document actually contains.

---

## Production deployment

Locally this runs on `localhost:8000`. In production it becomes a deployed service
(Railway, Render, Fly.io, or Cloud Run) and the Next.js app reads its URL from the
`PYTHON_SERVICE_URL` environment variable — the URL is never hardcoded.

Three things to change before deploying:

1. Drop `--reload` and run under a process manager:
   `uvicorn main:app --host 0.0.0.0 --port $PORT`
2. Restrict network access so only the Next.js app can reach it. This service receives
   un-redacted label text, so it must not be publicly exposed — put it on a private
   network or require a shared secret header.
3. Serve over HTTPS. Un-redacted PHI in transit over plain HTTP is exactly the leak this
   service exists to prevent.
