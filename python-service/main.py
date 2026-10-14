"""
MediBuddy Python microservice
=============================

Two jobs that Node.js cannot do well, so they live here in Python instead:

  POST /redact    — strip Protected Health Information (PHI) out of extracted label text
  POST /dailymed  — look up the official FDA drug label for a medication

WHY A SEPARATE PYTHON SERVICE AT ALL?
-------------------------------------
Microsoft Presidio is a Python-only library, and it depends on spaCy, which is also
Python-only. There is no JavaScript port that is anywhere near as good. We had two options:

  (a) Re-implement PHI detection in TypeScript with regexes.
  (b) Run a small Python service and call it over HTTP.

We chose (b). Regexes catch patterns ("###-##-####" looks like an SSN) but they cannot
catch *context* — and most PHI on a prescription label is contextual. "Patterson" is a
surname in "Patient: Mary Patterson" and a place in "Patterson Pharmacy, Main St".
A regex cannot tell those apart; a trained NLP model can. Rebuilding that in TypeScript
would mean rebuilding spaCy, which is not realistic.

TRADEOFF: we now have two processes to run and deploy instead of one. That is the real
cost of this decision. We accept it because PHI redaction is a correctness-and-legal
requirement, not a nice-to-have — getting it wrong means leaking patient identity into
a database. The DailyMed lookup is bundled into the same service only because it is also
I/O-and-parsing work that would otherwise bloat the Next.js route; it could just as easily
have stayed in TypeScript.
"""

import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

import requests
from fastapi import FastAPI
from pydantic import BaseModel

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

app = FastAPI(
    title="MediBuddy PHI + DailyMed Service",
    description="Presidio PHI redaction and FDA DailyMed label lookup for MediBuddy.",
    version="1.0.0",
)

# ──────────────────────────────────────────────────────────────────────────────
# Presidio engines — created ONCE at import, not per request
# ──────────────────────────────────────────────────────────────────────────────
#
# WHY THE SPACY MODEL IS REQUIRED (`python -m spacy download en_core_web_lg`):
#
# Presidio is not itself an AI model — it is a *framework* that coordinates several
# detection strategies. Underneath, for anything name- or place-shaped, it delegates to
# spaCy's NER (Named Entity Recognition) model. NER is a neural model trained on millions
# of sentences to answer: "given the words around it, what KIND of thing is this token?"
#
# That context-sensitivity is the whole point. Consider these two lines from real labels:
#
#     "Dr. May prescribed this on May 3"      → May(PERSON),    May(DATE_TIME)
#     "Take with food. Patient: Frank"        → Frank(PERSON),  'food' is not an entity
#
# The literal string "May" is a person in one position and a date in another. No pattern
# or word-list can resolve that; only a model that reads the surrounding words can.
# So Presidio without the spaCy model cannot detect PERSON or LOCATION at all —
# AnalyzerEngine would silently return far fewer entities instead of raising an error,
# which is the most dangerous kind of failure for a privacy tool. The model is a hard
# dependency, not an optimisation.
#
# We use en_core_web_lg (~560MB) rather than en_core_web_sm (~12MB) because the small
# model's NER accuracy is noticeably worse on short, fragmentary text — and prescription
# labels are exactly that: short fragments, not well-formed prose. Loading cost is paid
# once at startup, so the larger model costs us memory but not per-request latency.
#
# ANALYZER vs ANONYMIZER — two engines, two distinct jobs:
#
#   AnalyzerEngine   = the DETECTOR. Reads text, returns a list of findings:
#                      "chars 9–21 are a PERSON, confidence 0.85". It does not modify
#                      the text at all; it only reports coordinates and labels.
#
#   AnonymizerEngine = the REPLACER. Takes the original text plus the analyzer's list of
#                      findings, and produces new text with those spans substituted.
#
# They are separate because detection and replacement are genuinely independent choices.
# The same detection results can be masked, hashed, encrypted, or (our case) swapped for
# a readable tag. Keeping them split also lets us log *what* was found without logging the
# PHI itself — we can record "2 PERSON entities removed" without storing the names.
ANALYZER = AnalyzerEngine()
ANONYMIZER = AnonymizerEngine()

# WHY WE LIST SPECIFIC ENTITY TYPES INSTEAD OF DETECTING EVERYTHING:
#
# Presidio ships ~30 recognizers (credit cards, IBANs, crypto wallets, driver's licences,
# passport numbers, UK NHS numbers, and so on). Passing entities=None runs all of them.
# We deliberately pass an explicit list instead, for three reasons:
#
#   1. PRECISION. Every extra recognizer is another chance at a false positive. A pill
#      strength like "4111 1111 1111 1111 mg" is absurd, but NDC codes, lot numbers, and
#      prescription numbers genuinely do look like account or card numbers to a pattern
#      matcher. A false positive here is not harmless — it would redact medical content
#      the patient actually needs to read.
#   2. SPEED. Each recognizer scans the text. A prescription label will never contain a
#      crypto wallet address, so running that recognizer is pure latency.
#   3. INTENT. The list documents what we consider PHI on a medication label. A reader of
#      this file can see our privacy model at a glance instead of inferring it.
#
# These eight are what actually appears on a US prescription label: patient and
# prescriber names, dates of birth and fill dates, pharmacy and patient addresses,
# phone numbers, email addresses, SSNs (on some insurance-linked labels), prescriber
# DEA/NPI licence numbers, and pharmacy refill URLs.
PHI_ENTITIES = [
    "PERSON",            # patient name, doctor name, pharmacist name
    "DATE_TIME",         # date of birth, date filled, expiry date
    "LOCATION",          # patient address, pharmacy address
    "PHONE_NUMBER",      # pharmacy or prescriber phone
    "EMAIL_ADDRESS",     # patient contact email
    "US_SSN",            # appears on some insurance-linked labels
    "MEDICAL_LICENSE",   # prescriber DEA / NPI number
    "URL",               # pharmacy refill portal links
]

# How each detected entity is rendered in the redacted output.
#
# We replace with a readable TAG rather than deleting the span, because the tag preserves
# sentence structure for the downstream Claude call. "[PERSON] takes [DATE]" still reads
# as a sentence that Claude can reason about; "takes" alone is ambiguous rubbish.
#
# DATE_TIME is deliberately rendered as "[DATE]" (not "[DATE_TIME]") — it is the tag the
# rest of the pipeline and the project spec expect, and it reads better to a human
# auditing the stored text.
OPERATORS = {
    "PERSON":          OperatorConfig("replace", {"new_value": "[PERSON]"}),
    "DATE_TIME":       OperatorConfig("replace", {"new_value": "[DATE]"}),
    "LOCATION":        OperatorConfig("replace", {"new_value": "[LOCATION]"}),
    "PHONE_NUMBER":    OperatorConfig("replace", {"new_value": "[PHONE]"}),
    "EMAIL_ADDRESS":   OperatorConfig("replace", {"new_value": "[EMAIL]"}),
    "US_SSN":          OperatorConfig("replace", {"new_value": "[SSN]"}),
    "MEDICAL_LICENSE": OperatorConfig("replace", {"new_value": "[LICENSE]"}),
    "URL":             OperatorConfig("replace", {"new_value": "[URL]"}),
    # Fallback for any entity type Presidio reports that we did not map above.
    "DEFAULT":         OperatorConfig("replace", {"new_value": "[REDACTED]"}),
}


class RedactRequest(BaseModel):
    text: str


class RedactResponse(BaseModel):
    redacted_text: str
    entities_found: List[dict]


@app.post("/redact", response_model=RedactResponse)
def redact(payload: RedactRequest) -> RedactResponse:
    """
    Detect and replace PHI in raw extracted label text.

    HONEST LIMITATION — PRESIDIO HAS FALSE NEGATIVES, AND THIS MATTERS:
    ------------------------------------------------------------------
    Presidio will miss real PHI. This is not a configuration problem we can tune away;
    it is inherent to statistical NER.

    A MEASURED EXAMPLE — run against this service, not hypothetical:

        input : "1420 Oak Street, Springfield IL 62704"
        output: "1420 Oak Street, [LOCATION] IL [DATE]"

    The city is caught. The STREET ADDRESS is not — "1420 Oak Street" passes straight
    through, and a street address is a HIPAA identifier. (The ZIP code is caught, but
    mislabelled as a date, which is luck rather than correctness.) Treat this as the
    baseline expectation, not an outlier.

    Other known failure modes on prescription labels:

      • Unusual or non-Anglophone names. en_core_web_lg is trained largely on US English
        news and web text. Names outside that distribution are missed far more often —
        which means the failure is not randomly distributed, it is biased against exactly
        the patients least likely to be represented in the training data.
      • Names that are also common words. "Dr. Hope", "Mr. Long", "Patient: Rose" are
        frequently tagged as nothing at all, because in most English text those tokens
        genuinely are not people.
      • OCR noise. Our input is text Claude read off a photographed label. "Patient:
        J0hn Sm1th" (zero for O, one for I) defeats the model's tokenizer — the token no
        longer resembles a name it has seen.
      • Fragmentary layout. Labels are columns and scraps, not sentences. NER is weakest
        precisely where there is least surrounding context to read.

    THEREFORE: this is one layer, not the guarantee.
    Layer 1 is Claude's system prompt, which is instructed never to emit PHI in the first
    place (see MEDICATION_SYSTEM_PROMPT in the Next.js route).
    Layer 2 is this function, catching what Layer 1 leaked.
    Layer 3 is that we do not store the source image at all, and Postgres RLS isolates
    every row to its owner, so a leak is scoped to one patient's own record.

    No single layer is trusted. That is the point — see "defense in depth" in the README.
    If this service is ever unreachable, the caller must treat redaction as FAILED and
    store nothing, rather than storing unredacted text. The Next.js route does exactly
    that; it does not fall back to the raw string.

    TWO THINGS THAT WILL CONFUSE YOU WHEN TESTING THIS (both verified against Presidio
    2.2.357 — they are correct behaviour, not bugs to fix):

      1. PLACEHOLDER SSNs ARE DELIBERATELY IGNORED. UsSsnRecognizer.invalidate_result()
         rejects known-fake numbers, including anything starting with "123456789" and the
         famous "078-05-1120". So "SSN 123-45-6789" comes back UNREDACTED, which looks
         like a total failure of the SSN recognizer. It is not — a plausible SSN such as
         "536-90-4788" is detected at 0.85 confidence. Test with realistic values.
      2. DOSING TEXT IS AGGRESSIVELY FALSE-POSITIVE AS DATE_TIME. Measured:

             input : "LISINOPRIL 10MG TABLET take twice daily every 8 hours at bedtime"
             output: "LISINOPRIL [DATE] take [DATE] at [DATE]"

         The strength, the frequency, and the timing are ALL destroyed. This is acceptable
         *here* because redacted_text is only supplementary context for the explanation
         call, and the strength and schedule also reach Claude through the dedicated
         dosage and instructions fields.

         It is also precisely why the Next.js route does NOT run the patient-facing
         `instructions` field through this endpoint. Doing so would turn "take twice daily"
         into "take [DATE]" on the medication card — corrupting the single most important
         sentence an elderly patient reads, in order to redact a phrase that was never
         PHI. That field relies on the prompt layer instead. A redactor aggressive enough
         to guarantee no PHI in free text is also aggressive enough to destroy the medical
         content, so we apply it where the cost of a false positive is low and leave it off
         where the cost is high. That is a judgement call, and it is the honest one.
    """
    text = payload.text or ""

    # Nothing to do on empty input — and Presidio would waste a model pass on it.
    if not text.strip():
        return RedactResponse(redacted_text="", entities_found=[])

    # STEP 1 — DETECT. Returns RecognizerResult objects: entity_type, start, end, score.
    # The original text is untouched at this point.
    results = ANALYZER.analyze(text=text, entities=PHI_ENTITIES, language="en")

    # STEP 2 — REPLACE. The anonymizer needs both the text and the findings from step 1.
    anonymized = ANONYMIZER.anonymize(
        text=text,
        analyzer_results=results,
        operators=OPERATORS,
    )

    # We report WHAT was found and HOW CONFIDENT the model was — but never the matched
    # string itself. Logging the detected value would mean writing the PHI into our logs,
    # which defeats the entire purpose of this endpoint. Offsets are safe to return and
    # are useful for debugging a suspected miss.
    entities_found = [
        {
            "entity_type": r.entity_type,
            "start": r.start,
            "end": r.end,
            "score": round(r.score, 3),
        }
        for r in results
    ]

    return RedactResponse(
        redacted_text=anonymized.text,
        entities_found=entities_found,
    )


# ──────────────────────────────────────────────────────────────────────────────
# DailyMed lookup
# ──────────────────────────────────────────────────────────────────────────────
#
# WHAT DAILYMED IS:
# DailyMed is the US National Library of Medicine's official repository of FDA drug
# labels — the authoritative "package insert" text for every drug marketed in the US.
# When a manufacturer changes a label, the FDA-submitted version lands here. It is the
# same text a pharmacist reads, published as structured XML (SPL — Structured Product
# Labeling). It is free, requires no API key, and is the closest thing to ground truth
# for "what does this drug officially do".
#
# WHY THIS MATTERS FOR MEDIBUDDY:
# Without DailyMed, every word a patient reads in our app is model output. Claude is
# good, but it is generating from training data — it can be subtly out of date, or
# confidently wrong about a dose. For a medication app used by elderly patients, that is
# the single highest-consequence failure mode in the product. DailyMed lets us say
# "this came from the FDA label", and show a badge that means it.
#
# WHY rxnorm_code IS THE BRIDGE:
# We cannot search DailyMed by the name on the bottle. Brand names are not unique and
# not global: the same molecule is Tylenol in the US, Panadol in the UK, Crocin in India,
# Doliprane in France. Searching DailyMed for "Crocin" returns nothing.
#
# RxNorm solves this. It is NLM's drug vocabulary, and it assigns every clinical drug
# concept a stable numeric id (an RxCUI). Our Next.js route already resolves the scanned
# name → RxCUI at scan time. Both RxNorm and DailyMed are NLM systems and DailyMed
# indexes its labels by RxCUI, so that one integer is the join key between
# "what the bottle says" and "what the FDA says". It is the pivot that makes an
# internationally-named bottle resolvable to a US federal label.

RXNAV_RELATED_URL = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json?tty=IN"
DAILYMED_SPLS_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml"

HTTP_TIMEOUT = 15  # seconds — these are government servers and can be slow

# SPL documents are HL7 v3 XML, so every tag is namespaced. ElementTree reports tags as
# "{urn:hl7-org:v3}section", which makes naive tag matching fail silently. We match on
# the local name instead (see `_local`) so the parser does not depend on the namespace
# declaration staying exactly as it is today.
HL7_NS = "urn:hl7-org:v3"

# Which SPL section feeds which field of our response.
#
# Labels come in two flavours with completely different section vocabularies:
# prescription labels use "INDICATIONS & USAGE SECTION"; over-the-counter labels use
# "OTC - PURPOSE SECTION". A patient's medication list will contain both, so every field
# lists the Rx name first and the OTC equivalents after, and we take the first one the
# document actually has. Matching is on the LOINC `displayName` attribute, which is what
# DailyMed populates consistently across both flavours.
SECTION_MAP: Dict[str, List[str]] = {
    "purpose": [
        "INDICATIONS & USAGE SECTION",   # prescription
        "OTC - PURPOSE SECTION",         # over-the-counter
        "OTC - INDICATIONS & USAGE",
    ],
    "dosage": [
        "DOSAGE & ADMINISTRATION SECTION",
        "OTC - DOSAGE & ADMINISTRATION SECTION",
        "DOSAGE FORMS & STRENGTHS SECTION",
    ],
    "side_effects": [
        "ADVERSE REACTIONS SECTION",
        "OTC - STOP USE SECTION",        # the OTC analogue of "side effects to watch for"
        "OTC - WHEN USING SECTION",
    ],
    "warnings": [
        "BOXED WARNING SECTION",         # most severe class of FDA warning — prefer it
        "WARNINGS SECTION",
        "WARNINGS AND PRECAUTIONS SECTION",
        "OTC - DO NOT USE SECTION",
    ],
}

# FDA label sections run to tens of thousands of characters (the full adverse-reactions
# section of a cardiac drug is a small book). All of this text is forwarded to Claude for
# the explanation call, so we cap each field. Beyond roughly this length we are paying
# tokens for clinical-trial tables that will never reach the patient's screen.
MAX_FIELD_CHARS = 2500

# How many candidate labels to try before giving up. DailyMed returns many SPLs per
# ingredient — different manufacturers, different package sizes, some of them kits or
# combination products with sparse sections. Trying a few and keeping the first usable one
# is far more reliable than trusting the first result, but we bound it so one lookup
# cannot take 10 sequential HTTP round-trips.
MAX_LABEL_CANDIDATES = 3

# How many search results to RANK before picking those candidates. We over-fetch from the
# index (one cheap request) so that _combination_penalty has a real pool to choose from —
# the single-ingredient label for a common drug is often not in DailyMed's first three
# results. Only the chosen candidates are then fetched in full, so this costs one list
# request, not 25 label downloads.
SPL_SEARCH_PAGESIZE = 25


class DailyMedRequest(BaseModel):
    rxnorm_code: str


class DailyMedResponse(BaseModel):
    purpose: Optional[str] = None
    dosage: Optional[str] = None
    side_effects: List[str] = []
    warnings: Optional[str] = None
    verified: bool = False
    # Which FDA label we actually used, so the UI can cite a source and a developer can
    # reproduce the lookup. Harmless to expose — it is public FDA data, not patient data.
    source_setid: Optional[str] = None
    ingredient: Optional[str] = None


def _local(tag: str) -> str:
    """Strip the XML namespace, turning '{urn:hl7-org:v3}section' into 'section'."""
    return tag.rsplit("}", 1)[-1]


def _collect_text(element: ET.Element) -> str:
    """
    Flatten an SPL <text> block into a readable plain string.

    SPL body text is nested markup — <paragraph>, <list><item>, <table>, <content> with
    styleCode for bold. ET.itertext() walks all descendants and yields every text node,
    which gives us the words in document order without us having to handle each tag type.
    We then normalise whitespace, because the XML is pretty-printed and otherwise arrives
    full of newlines and runs of indentation spaces.
    """
    raw = "".join(element.itertext())
    # FDA-submitted XML is full of encoding debris: non-breaking spaces, the Unicode
    # replacement character (U+FFFD) where a submitter's encoding was wrong, soft
    # hyphens, and stray control characters. We normalise all of it to plain spaces
    # here rather than letting it reach Claude or the patient's screen.
    # chr(0xFFFD) is the Unicode replacement character, which appears wherever an
    # FDA submitter's encoding was wrong. str.isprintable() is False for control
    # characters AND for non-space separators such as the non-breaking space, so one
    # pass handles every class of debris without needing escape sequences here.
    raw = "".join(character if character.isprintable() else " " for character in raw)
    raw = raw.replace(chr(0xFFFD), " ")
    return re.sub(r"\s+", " ", raw).strip()


def _extract_items(element: ET.Element) -> List[str]:
    """
    Pull explicit <item> entries out of an SPL <text> block.

    Preferred over splitting prose whenever the label provides a list, because the
    submitter has already told us where one effect ends and the next begins. Most OTC
    labels and many prescription labels bullet their side effects, and guessing
    boundaries from punctuation is strictly worse when real structure is available.
    """
    items: List[str] = []
    for node in element.iter():
        if _local(node.tag) == "item":
            text = _collect_text(node)
            if text:
                items.append(text)
    return items


# Phrases that mark a fragment as clinical-trial narrative rather than a side effect.
# FDA adverse-reaction sections open with study methodology ("evaluated for safety in
# 930 patients", "in placebo-controlled trials") and are full of cross-references
# ("but see WARNINGS regarding angioedema"). None of that belongs on an elderly
# patient's medication card, and forwarding it to the explanation call both wastes
# tokens and invites Claude to echo trial methodology back as if it were a symptom.
NARRATIVE_MARKERS = re.compile(
    r"\b(patients?|trials?|placebo|clinical|studies|stud(y|ied)|evaluated|"
    r"incidence|discontinuation|therapy|reported|see|listed|following|table|section|"
    r"experiences?|adverse|postmarketing|frequency|treatment|administration|dose|"
    r"dosage|transient|principally|because|including|associated|observed|occurred)\b",
    flags=re.I,
)


def _truncate(text: str, limit: int = MAX_FIELD_CHARS) -> str:
    """Cut to a sentence boundary where possible, so Claude never reads a half-sentence."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    last_stop = cut.rfind(". ")
    # Only honour the sentence boundary if it is reasonably near the end, otherwise we
    # would throw away most of the field chasing a period.
    if last_stop > limit * 0.6:
        return cut[: last_stop + 1]
    return cut.rstrip() + "…"


def _split_side_effects(text: str, items: Optional[List[str]] = None) -> List[str]:
    """
    Turn an adverse-reactions section into a list of individual effects.

    The schema stores side_effects as a Postgres text[] so individual effects can be
    queried later ("show me everything that causes drowsiness"), which means we need a
    list of discrete effects, not a paragraph chopped at punctuation.

    Three strategies, in order of how much we trust them:

      1. EXPLICIT <item> ELEMENTS. If the label bullets its effects in markup, the
         submitter has already marked the boundaries. Always prefer this.
      2. BULLET CHARACTERS. OTC labels usually render lists as plain text split by literal
         bullet glyphs. Still an author-supplied boundary, just a typographic one.
      3. COMMA ENUMERATION. "Headache, dizziness, cough, fatigue" — a comma-dense field
         with short fragments is reliably a list written as prose.
      4. GIVE UP ON SPLITTING. If the section is clinical-trial narrative, there are no
         discrete effects to extract. Return nothing rather than inventing boundaries.

    Strategy 4 is the important one. An earlier version sentence-split the prose and
    produced entries like "Lisinopril has been evaluated for safety in 930 patients" and
    "But see WARNINGS regarding angioedema" — study methodology and cross-references
    presented to the patient as symptoms to watch for. Returning an empty list is the
    correct outcome there: the pipeline then falls back to Claude's own extraction, which
    read the actual bottle, and the patient gets a real answer instead of a fabricated one.
    """
    candidates: List[str] = []

    # Strategy 1 — trust the label's own list markup.
    if items:
        candidates = list(items)

    # Strategy 2 — bullet characters. OTC labels very often render their lists as plain
    # text separated by literal "' + BULLET + '" glyphs rather than <item> markup, which is still an
    # explicit boundary the submitter put there — just expressed typographically.
    elif text and text.count(chr(0x2022)) >= 2:
        candidates = text.split(chr(0x2022))

    # Strategy 3 — a comma-dense field is an enumeration written as prose.
    elif text and text.count(",") >= 3:
        candidates = re.split(r"[,;]", text)

    cleaned: List[str] = []
    for item in candidates:
        # OTC labels prefix list entries with a literal "o" bullet; strip leaders.
        item = re.sub(r"^[\s•o\-*]+", "", item).strip(" .;:—-")
        if not item:
            continue
        # A real side effect is a short noun phrase. Much longer than this and it is a
        # sentence of narrative; much shorter and it is punctuation debris.
        if not (3 < len(item) <= 80):
            continue
        # Reject clinical-trial narrative and cross-references (see NARRATIVE_MARKERS).
        if NARRATIVE_MARKERS.search(item):
            continue
        # Reject anything that is mostly digits — percentages and incidence figures.
        if sum(character.isdigit() for character in item) > len(item) / 3:
            continue
        cleaned.append(item[0].upper() + item[1:])
        if len(cleaned) >= 12:
            break

    return cleaned



def _combination_penalty(title: str, ingredient: Optional[str]) -> int:
    """
    Score an SPL title so single-ingredient labels sort ahead of combination products.
    Lower is better.

    WHY THIS EXISTS — A REAL BUG THIS CODE FIXES:
    DailyMed's rxcui index returns every label whose product *contains* that ingredient,
    including multi-drug combinations, and it does not rank them. Taking the first result
    gave us, verbatim:

        metformin   (rxcui 6809)  → "DAPAGLIFLOZIN AND METFORMIN HCL EXTENDED-RELEASE TABLETS"
        lisinopril  (rxcui 29046) → "LISINOPRIL AND HYDROCHLOROTHIAZIDE TABLET"

    A patient taking plain metformin would then have been shown the purpose, dosage and
    warnings of a two-drug product they are not taking. The text would be real FDA text,
    carrying our "FDA Verified" badge, and wrong — the worst combination available. An
    authoritative source does not help if we pick the wrong document out of it.

    Titles look like:
        "LISINOPRIL TABLET [MANUFACTURER]"                                      → ideal
        "LISINOPRIL AND HYDROCHLOROTHIAZIDE TABLET [MANUFACTURER]"              → 2 drugs
        "TABCIN (ACETAMINOPHEN, DEXTROMETHORPHAN, PHENYLEPHRINE) CAPSULE [MFR]" → 3 drugs

    So we count ingredient-boundary markers — " AND " plus commas inside the active-
    ingredient parenthetical — and prefer the fewest. We also prefer titles that actually
    begin with the ingredient we asked for, since a generic single-ingredient label is
    named after its drug while a brand combination product is not.

    This is a heuristic on a human-written title, not a guarantee. It is still a large
    improvement over position-in-search-results, which carries no signal at all.
    """
    normalized = title.upper()

    # Drop the "[MANUFACTURER NAME]" suffix — company names contain their own commas and
    # "AND"s ("SMITH, KLINE AND CO") that would otherwise count as ingredients.
    bracket = normalized.find("[")
    if bracket != -1:
        normalized = normalized[:bracket]

    penalty = normalized.count(" AND ") + normalized.count(",")

    # Reward a title that leads with the ingredient we actually looked up.
    if ingredient and normalized.strip().startswith(ingredient.upper()):
        penalty -= 1

    return penalty


def _resolve_ingredient(rxnorm_code: str) -> Optional[str]:
    """
    RxCUI → active ingredient name, via RxNav's `related` endpoint with tty=IN.

    `tty` is RxNorm's "term type". IN means "ingredient" — the base molecule, stripped of
    dose, form, and brand. We ask for it because a scanned bottle usually resolves to a
    very specific concept ("lisinopril 10 MG oral tablet"), and that specific string is a
    poor search term. The ingredient ("lisinopril") is what DailyMed indexes labels under,
    so this call is what turns a precise clinical concept into a usable search key.
    """
    try:
        response = requests.get(
            RXNAV_RELATED_URL.format(rxcui=rxnorm_code), timeout=HTTP_TIMEOUT
        )
        if not response.ok:
            return None
        groups = response.json().get("relatedGroup", {}).get("conceptGroup", []) or []
        for group in groups:
            if group.get("tty") != "IN":
                continue
            properties = group.get("conceptProperties") or []
            if properties:
                return properties[0].get("name")
    except (requests.RequestException, ValueError):
        # ValueError covers a non-JSON body, which RxNav occasionally returns under load.
        return None
    return None


def _find_label_setids(rxnorm_code: str, ingredient: Optional[str]) -> List[str]:
    """
    Find candidate FDA label ids (setids) for this drug.

    NOTE ON A SPEC DEVIATION — `ingredient=` DOES NOT WORK:
    The DailyMed v2 API ignores an unrecognised query parameter instead of rejecting it,
    and `?ingredient=` is unrecognised. Calling spls.json?ingredient=acetaminophen returns
    the entire database (159,000+ labels, starting with antihistamines and hand wipes) with
    HTTP 200 — a silent wrong answer, which is worse than an error, because the pipeline
    would happily attach a random label to a patient's medication.
    The parameters that do filter are `rxcui=` and `drug_name=`. So we query:
      1. rxcui — the most precise match, and it keeps the RxNorm bridge intact end to end.
      2. drug_name=<ingredient> — a fallback for drugs indexed by name but not by RxCUI.
    The ingredient lookup above is still what makes step 2 work, so it stays in the flow.
    """
    candidates: List[tuple] = []  # (title, setid), in the order DailyMed returned them

    def query(params: dict) -> List[tuple]:
        try:
            response = requests.get(
                DAILYMED_SPLS_URL,
                params={**params, "pagesize": SPL_SEARCH_PAGESIZE},
                timeout=HTTP_TIMEOUT,
            )
            if not response.ok:
                return []
            entries = response.json().get("data", []) or []
            return [
                (entry.get("title") or "", entry["setid"])
                for entry in entries
                if entry.get("setid")
            ]
        except (requests.RequestException, ValueError, KeyError):
            return []

    candidates.extend(query({"rxcui": rxnorm_code}))

    if not candidates and ingredient:
        candidates.extend(query({"drug_name": ingredient}))

    # Deduplicate by setid, keeping first-seen order.
    seen: Dict[str, str] = {}
    for title, setid in candidates:
        seen.setdefault(setid, title)

    # Rank before truncating — see _combination_penalty. Taking DailyMed's own first result
    # is what produced the metformin bug described there.
    ranked = sorted(
        seen.items(),
        key=lambda pair: _combination_penalty(pair[1], ingredient),
    )
    return [setid for setid, _title in ranked[:MAX_LABEL_CANDIDATES]]


def _parse_label(setid: str) -> Optional[dict]:
    """
    Fetch one SPL document and pull out the four sections we care about.

    Only the .xml representation carries the label body. The /spls/{setid}.json endpoint
    exists but returns an empty response — the JSON API covers the *index* (titles, setids,
    publication dates), not section content. So XML parsing is required here, not a choice.
    """
    try:
        response = requests.get(
            DAILYMED_SPL_XML_URL.format(setid=setid), timeout=HTTP_TIMEOUT
        )
        if not response.ok:
            return None
        root = ET.fromstring(response.content)
    except (requests.RequestException, ET.ParseError):
        return None

    # Build displayName → section text for every section in the document. Sections nest
    # (a parent "WARNINGS" can contain sub-sections), so we walk the whole tree with
    # iter() rather than only the top level.
    # displayName -> (flattened text, the <text> element it came from). We keep the
    # element, not just the string, because side-effect extraction needs to reach the
    # label's own <item> markup — see _split_side_effects.
    sections: Dict[str, tuple] = {}
    for section in root.iter():
        if _local(section.tag) != "section":
            continue

        display_name = None
        body = None
        for child in section:
            name = _local(child.tag)
            if name == "code":
                display_name = (child.get("displayName") or "").strip().upper()
            elif name == "text":
                body = child

        if not display_name:
            continue

        if body is not None:
            # Simple case: the section holds its own <text> child.
            text = _collect_text(body)
            items_source = body
        else:
            # NESTED CASE — and it is common enough that ignoring it broke real drugs.
            # Many modern labels use a parent section that carries only the title and
            # LOINC code, with the actual prose in <excerpt> and <component><section>
            # children. Every generic lisinopril label is shaped this way: the
            # "INDICATIONS & USAGE SECTION" element has no direct <text>, so requiring one
            # made the whole label unparseable and silently dropped it to verified:false
            # for one of the most commonly prescribed drugs in the country.
            # So when there is no direct <text>, gather every descendant <text> instead.
            descendants = [
                node for node in section.iter() if _local(node.tag) == "text"
            ]
            if not descendants:
                continue
            text = " ".join(filter(None, (_collect_text(node) for node in descendants)))
            # Pass the whole section so _extract_items can still find nested <item>s.
            items_source = section

        body = items_source
        # Keep the longest version when a name appears more than once (repeated sections
        # across package configurations are common, and the fullest one is the useful one).
        existing = sections.get(display_name)
        if text and (existing is None or len(text) > len(existing[0])):
            sections[display_name] = (text, body)

    if not sections:
        return None

    def first_match(names: List[str]) -> tuple:
        """Return (text, element) for the first section name this document has."""
        for name in names:
            if name in sections:
                return sections[name]
        # Substring fallback — FDA submitters sometimes append qualifiers to a section
        # name, e.g. "WARNINGS SECTION (SEE ALSO PRECAUTIONS)".
        for name in names:
            for key, value in sections.items():
                if name in key:
                    return value
        return (None, None)

    purpose, _ = first_match(SECTION_MAP["purpose"])
    dosage, _ = first_match(SECTION_MAP["dosage"])
    side_effects_text, side_effects_element = first_match(SECTION_MAP["side_effects"])
    warnings, _ = first_match(SECTION_MAP["warnings"])

    # A label with no indications section tells the patient nothing about what the drug is
    # for, which is the single most important field in our UI. Treat that as unusable and
    # let the caller try the next candidate label.
    if not purpose:
        return None

    return {
        "purpose": _truncate(purpose),
        "dosage": _truncate(dosage) if dosage else None,
        "side_effects": _split_side_effects(
            side_effects_text or "",
            items=_extract_items(side_effects_element) if side_effects_element is not None else None,
        ),
        "warnings": _truncate(warnings) if warnings else None,
        "source_setid": setid,
    }


@app.post("/dailymed", response_model=DailyMedResponse)
def dailymed(payload: DailyMedRequest) -> DailyMedResponse:
    """
    RxCUI → official FDA label data.

    WHY `verified: false` IS A FIRST-CLASS RESULT, NOT AN ERROR:
    -----------------------------------------------------------
    DailyMed is the FDA's database, so it only contains drugs marketed in the United
    States. It will legitimately not have:

      • Internationally prescribed medications. A patient filling a prescription in India,
        the UK, or Brazil may be taking something with no US label at all.
      • Compounded and specialty-pharmacy preparations.
      • Drugs whose RxNorm lookup failed upstream, so there is no RxCUI to search with.
      • Labels that exist but are structured too sparsely to parse usefully.

    None of those are failures of our code, and none of them should break a scan. If this
    endpoint raised an error or returned 404, the Next.js route would have to decide
    between crashing the user's upload or writing exception-handling around a normal
    outcome. Instead we always return 200 with the same response shape, and let one
    boolean carry the meaning:

        verified: true   → fields came from the FDA label. UI shows "FDA Verified".
        verified: false  → we have nothing. Caller falls back to Claude's own extraction.

    The patient still gets a complete, useful explanation either way; the badge is simply
    absent. That is the difference between a degraded feature and a broken app — and for
    an elderly user, an app that fails on an unusual medication is an app they stop
    trusting. Being honest about provenance is also the ethical requirement here: we must
    never imply FDA backing for text a model generated.
    """
    rxnorm_code = (payload.rxnorm_code or "").strip()
    if not rxnorm_code:
        return DailyMedResponse(verified=False)

    ingredient = _resolve_ingredient(rxnorm_code)
    setids = _find_label_setids(rxnorm_code, ingredient)

    for setid in setids:
        parsed = _parse_label(setid)
        if parsed:
            return DailyMedResponse(
                purpose=parsed["purpose"],
                dosage=parsed["dosage"],
                side_effects=parsed["side_effects"],
                warnings=parsed["warnings"],
                verified=True,
                source_setid=parsed["source_setid"],
                ingredient=ingredient,
            )

    # No usable label found — the documented, expected fallback path.
    return DailyMedResponse(verified=False, ingredient=ingredient)


@app.get("/health")
def health() -> dict:
    """
    Liveness probe.

    The Next.js route calls this on nothing, but it is how you confirm the service is up
    without sending it real label text — useful because a failed /redact must block a
    save, so "is the service running" is a question you will ask while debugging.
    """
    return {"status": "ok", "presidio_entities": PHI_ENTITIES}
