import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/analyze-medication
 *
 * The full scan pipeline, in order:
 *
 *   1. Receive the label image from the frontend
 *   2. Claude Haiku (vision) → extract medication name, dosage, instructions, raw text
 *   3. RxNorm → normalize the drug name to a canonical RxCUI code
 *   4. Python service /redact → Presidio strips PHI from the raw label text
 *   5. Python service /dailymed → fetch the official FDA label for that RxCUI
 *   6. Claude Haiku (text) → turn whichever data source won into a warm explanation
 *   7. Insert into Supabase, with dailymed_verified recording the provenance
 *   8. Return the saved record to the frontend
 *
 * Steps 4–6 are new in Tier 2. Steps 1–3, 7 and 8 are unchanged in shape.
 */

/** What Claude's first (vision) pass pulls off the label. */
interface MedicationExtraction {
  medication_name: string;
  dosage: string;
  instructions: string;
  purpose: string;
  side_effects: string[];
  raw_label_text: string;
}

/** Response shape of POST {PYTHON_SERVICE_URL}/redact */
interface RedactResponse {
  redacted_text: string;
  entities_found: { entity_type: string; start: number; end: number; score: number }[];
}

/** Response shape of POST {PYTHON_SERVICE_URL}/dailymed */
interface DailyMedResponse {
  purpose?: string | null;
  dosage?: string | null;
  side_effects?: string[];
  warnings?: string | null;
  verified: boolean;
  source_setid?: string | null;
  ingredient?: string | null;
}

/** What Claude's second (explanation) pass returns. */
interface MedicationExplanation {
  purpose: string;
  instructions: string;
  side_effects: string[];
}

// WHY THE MICROSERVICE URL COMES FROM AN ENV VAR:
// Locally both processes run on this machine, so the Python service is at
// localhost:8000. In production the Next.js app is on Vercel and the Python service is
// deployed separately (Railway / Render / Fly.io / Cloud Run), so "localhost" would mean
// "the Vercel serverless container itself" — where nothing is listening. Reading the URL
// from PYTHON_SERVICE_URL means the same code runs in both places and only the
// environment changes. The localhost default is a development convenience, not a
// production assumption.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

// EXTRACTION PROMPT — Claude's first job: read the label, report what is on it.
//
// This prompt still asks for purpose and side_effects even though explanation now happens
// in a second call. That is deliberate: those fields are our FALLBACK data source for
// when DailyMed has no entry for this drug (see the fallback pattern below). Without them
// an internationally prescribed medication would produce an empty card.
const MEDICATION_SYSTEM_PROMPT = `You are a warm, patient medication assistant helping elderly patients understand their prescriptions.
Your job is to look at a medication label image and extract information, then explain it in plain, friendly English.

CRITICAL PRIVACY RULE — read this first:
- You must NOT include any personal identifying information in ANY field.
- This means: no patient name, no date of birth, no address, no phone number, no doctor name, no pharmacy name, no prescription number.
- Even in raw_label_text, omit all of the above. If you see "Patient: John Smith", write nothing for that part.
- Why: this data will be stored in a database, and health data must never be linked to identifiable people unless absolutely necessary.

EXTRACTION TASK:
Extract the following from the label:
- The medication name (generic name preferred over brand name if both are present)
- Dosage (e.g., "10mg", "500mg twice daily")
- Instructions (when and how to take it, exactly as written on the label)
- The raw text of the label (everything except personal identifiers — see privacy rule above)

EXPLANATION TASK:
Using clear, warm language suitable for someone who may not have a medical background:
- Explain what this medication is typically used for (its PURPOSE)
- Explain how and when to take it in friendly, conversational language
- List the 3–5 most common or important side effects to watch for
- If you must use a medical term, explain it immediately in parentheses. Example: "hypertension (high blood pressure)"
- Tone: imagine you are a kind, patient pharmacist speaking to an 80-year-old grandparent

OUTPUT FORMAT:
You must respond with ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.
The JSON must have exactly these fields:

{
  "medication_name": "string — generic name of the drug",
  "dosage": "string — dose and frequency from the label",
  "instructions": "string — friendly plain-English explanation of how/when to take it",
  "purpose": "string — warm plain-English explanation of what this medication does and why a doctor prescribes it",
  "side_effects": ["string", "string", "..."] — array of 3–5 side effects, each explained plainly,
  "raw_label_text": "string — the label text with all personal identifiers removed"
}

If the image is blurry, not a medication label, or you cannot confidently extract the medication name,
still return valid JSON but set medication_name to "Unknown" and explain the issue in the purpose field.`;

// EXPLANATION PROMPT — Claude's second job: translate, never extract.
//
// WHY A SECOND CLAUDE CALL INSTEAD OF DOING IT ALL IN ONE:
//
// 1. SEPARATION OF CONCERNS. Extraction and explanation are genuinely different tasks
//    with different inputs and different failure modes. Extraction reads a photograph and
//    is constrained by what is physically printed on the label — it must not invent.
//    Explanation reads text and is asked to rewrite it warmly — it must rephrase freely.
//    Those are opposite instructions. Pushing both into one prompt makes each worse: the
//    model either invents label details to sound helpful, or writes stiffly because it is
//    simultaneously being told to stay literal.
//
// 2. THE DAILYMED DATA DOES NOT EXIST YET DURING CALL ONE. This is the structural reason.
//    We cannot explain the FDA label text in the first call, because we have not fetched
//    it — we need the medication name from call one to get the RxCUI, and the RxCUI to get
//    the label. The data arrives after the first call finishes, so a second call is the
//    only place it can be explained.
//
// 3. FDA LABEL TEXT IS UNREADABLE AS-IS, AND THAT IS THE WHOLE POINT. DailyMed gives us
//    authoritative text written for clinicians: "Lisinopril is indicated for the treatment
//    of hypertension, to lower blood pressure. Lowering blood pressure lowers the risk of
//    fatal and non-fatal cardiovascular events." Accurate, and useless to an 80-year-old.
//    Grounding our content in verified sources only helps if someone translates those
//    sources. That translation is this call's entire job.
//
// TRADEOFF: two API calls means roughly double the token cost and a second round-trip of
// latency on every scan. Worth it — the alternative is either ungrounded content or
// clinical prose the target user cannot read.
const EXPLANATION_SYSTEM_PROMPT = `You are a kind, patient pharmacist explaining a medication to an 80-year-old patient who has no medical background.

You will be given information about one medication. Some of it may be official FDA label text, which is accurate but written for doctors. Your job is to TRANSLATE it into warm, plain English.

YOUR JOB IS EXPLANATION ONLY — NOT EXTRACTION:
- Use ONLY the information you are given. Do not add facts from your own knowledge.
- Do not invent dosages, schedules, or warnings that are not in the provided information.
- If the provided information does not cover something, simply leave it out rather than filling the gap.
- Why this matters: incorrect medication information could genuinely harm this patient. Being incomplete is safe; being wrong is not.

HOW TO WRITE:
- Short sentences. One idea per sentence.
- Everyday words. "High blood pressure", not "hypertension". "Swelling", not "edema".
- If you must use a medical term, explain it immediately in parentheses: "an ACE inhibitor (a type of blood pressure medicine)".
- Warm and calm. Never alarming. The patient should finish reading feeling informed, not frightened.
- Speak directly to the patient using "you" and "your".
- Never tell the patient to change their dose or stop taking it. If something sounds concerning, direct them to their doctor or pharmacist.

SIDE EFFECTS specifically:
- Choose the 3–5 most important or most common ones. Do not list twenty.
- Rewrite each one in plain words. "Dyspepsia" becomes "an upset stomach".
- Frame them as things to watch for, not things that will definitely happen.

OUTPUT FORMAT:
Respond with ONLY valid JSON — no markdown, no code fences, no text outside the JSON:

{
  "purpose": "string — warm plain-English explanation of what this medication does and why a doctor prescribes it (2–4 sentences)",
  "instructions": "string — friendly plain-English explanation of how and when to take it (2–4 sentences)",
  "side_effects": ["string", "string", "..."] — array of 3–5 side effects in plain language
}`;

/** Claude occasionally wraps JSON in ```json fences despite being told not to. */
function parseClaudeJson<T>(rawText: string): T {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function POST(request: Request) {
  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 — Receive the image (unchanged)
  // ───────────────────────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data with an image file." },
      { status: 400 }
    );
  }

  const imageFile = formData.get("image") as File | null;
  if (!imageFile) {
    return NextResponse.json(
      { error: "No image field found in the request. Send the file under the key 'image'." },
      { status: 400 }
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Missing Authorization header. You must be logged in to analyze a medication." },
      { status: 401 }
    );
  }

  // Per-request client scoped to the calling user via their JWT — never trust client-supplied user_id.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: "Invalid or expired session. Please log in again." },
      { status: 401 }
    );
  }

  const imageBuffer = await imageFile.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mediaType = (imageFile.type || "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2 — Claude Haiku vision: extract what is printed on the label (unchanged)
  // ───────────────────────────────────────────────────────────────────────────
  let extraction: MedicationExtraction;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: MEDICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: "Please analyze this medication label and return the JSON as instructed." },
          ],
        },
      ],
    });

    extraction = parseClaudeJson<MedicationExtraction>(textFromMessage(message));
  } catch (err) {
    console.error("Claude extraction failed:", err);
    return NextResponse.json(
      { error: "Could not extract medication information from the image. Please ensure the label is clearly visible and try again." },
      { status: 422 }
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 — RxNorm: normalize the drug name to a canonical RxCUI (unchanged)
  // ───────────────────────────────────────────────────────────────────────────
  // This runs before the DailyMed call because the RxCUI is the join key between the name
  // on the bottle and the FDA's label database. No RxCUI means no DailyMed lookup.
  let rxnormCode: string | null = null;

  try {
    const rxnormUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(extraction.medication_name)}`;
    const rxnormResponse = await fetch(rxnormUrl);

    if (rxnormResponse.ok) {
      const rxnormData = await rxnormResponse.json();
      const codes: string[] | undefined = rxnormData?.idGroup?.rxnormId;
      rxnormCode = codes?.[0] ?? null;
    }
    // RxNorm failure is non-fatal — medication is still saved, interaction checker skips null codes.
  } catch {
    console.warn(`RxNorm lookup failed for "${extraction.medication_name}" — saving with null rxnorm_code.`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4 — NEW: Presidio PHI redaction via the Python microservice
  // ───────────────────────────────────────────────────────────────────────────
  //
  // WHY raw_label_text NOW STORES THE REDACTED TEXT ONLY — PHI NEVER PERSISTS:
  //
  // Previously we stored whatever Claude returned in raw_label_text and trusted the
  // system prompt to have stripped identifiers. That is one layer, and it is a
  // probabilistic one: a model instructed not to emit PHI will still sometimes emit PHI,
  // especially when the label layout is unusual. Prompt instructions are not an access
  // control.
  //
  // The property we actually want is that our database never contains patient identity at
  // all. Not "rarely contains" — never. The only way to get there is to pass the text
  // through a dedicated detector and store its output instead of the input. So:
  //
  //   extraction.raw_label_text  — the model's output. Exists in memory, in this request,
  //                                for a few hundred milliseconds. Never written anywhere.
  //   redactedLabelText          — what Presidio returned. This is what gets stored.
  //
  // The un-redacted string is never inserted, never logged, and never returned to the
  // client. It is garbage-collected when this request ends.
  //
  // WHY ONLY raw_label_text GOES THROUGH PRESIDIO, AND NOT instructions/purpose/dosage:
  // Presidio's DATE_TIME recognizer matches dosing schedules — "twice daily", "every 8
  // hours", "at bedtime" all come back tagged as dates (verified behaviour, see the
  // /redact docstring). In raw_label_text that is harmless: it is supplementary context
  // for the explanation call, and the real schedule reaches Claude through the dedicated
  // instructions field. Running `instructions` through the same redactor would print
  // "Take [DATE] with food" on an elderly patient's medication card — destroying the most
  // important sentence on the screen in order to redact a phrase that was never PHI.
  // Those fields rely on the prompt layer instead. A redactor aggressive enough to
  // guarantee no PHI in free text is also aggressive enough to ruin the medical content,
  // so we apply it where a false positive is cheap and omit it where it is expensive.
  //
  // WHY A REDACTION FAILURE BLOCKS THE SAVE INSTEAD OF FALLING BACK:
  // Everywhere else in this pipeline a service failure degrades gracefully. Here it must
  // not. If the Python service is down, the only "fallback" available is storing the
  // un-redacted text — which is precisely the outcome this step exists to prevent. A
  // failed scan is an inconvenience; silently persisting a patient's name and date of
  // birth is a data breach. So this is the one dependency we treat as hard.
  let redactedLabelText: string;

  try {
    const redactResponse = await fetch(`${PYTHON_SERVICE_URL}/redact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: extraction.raw_label_text ?? "" }),
    });

    if (!redactResponse.ok) {
      throw new Error(`Redaction service returned ${redactResponse.status}`);
    }

    const redactData: RedactResponse = await redactResponse.json();
    redactedLabelText = redactData.redacted_text;

    // Log the COUNT of what was removed, never the values — logging the matched strings
    // would write the PHI into our logs and defeat the whole exercise.
    if (redactData.entities_found.length > 0) {
      const byType = redactData.entities_found.reduce<Record<string, number>>((acc, e) => {
        acc[e.entity_type] = (acc[e.entity_type] ?? 0) + 1;
        return acc;
      }, {});
      console.info("Presidio redacted PHI before storage:", byType);
    }
  } catch (err) {
    console.error("PHI redaction failed — refusing to store un-redacted label text:", err);
    return NextResponse.json(
      {
        error:
          "We could not safely process your label right now, so nothing was saved. Please try again in a moment.",
        detail: "PHI redaction service unavailable.",
      },
      { status: 503 }
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5 — NEW: DailyMed lookup for official FDA label data
  // ───────────────────────────────────────────────────────────────────────────
  //
  // THE FALLBACK PATTERN — WHY EVERY EXTERNAL SOURCE NEEDS ONE:
  //
  // DailyMed is the FDA's database, so it covers drugs marketed in the United States and
  // nothing else. It will legitimately have no entry for:
  //   • internationally prescribed medications (Crocin, Doliprane, locally licensed drugs)
  //   • compounded and specialty-pharmacy preparations
  //   • anything whose RxNorm lookup failed upstream, leaving us no RxCUI to search with
  //
  // MediBuddy explicitly targets a global user base, so "no FDA entry" is not an edge
  // case — it is an expected, routine outcome for a meaningful share of our users.
  //
  // DEFENSIVE PROGRAMMING MATTERS MORE HERE THAN IN MOST APPS. The failure we are guarding
  // against is not a crash; it is a blank card. An elderly patient who scans their
  // prescription and gets an error, or an empty screen, does not file a bug report —
  // they conclude the app does not work and stop using it. And the app they stop using is
  // the one helping them take their medication correctly. So the design rule is: the
  // patient always gets a complete, useful explanation. The FDA badge is a bonus on top,
  // never a precondition.
  //
  // Note the asymmetry with step 4, which is deliberate. Missing DailyMed data degrades
  // quality, so we fall back. Missing redaction leaks PHI, so we refuse. Graceful
  // degradation is correct for quality and wrong for safety.
  let dailyMed: DailyMedResponse = { verified: false };

  if (rxnormCode) {
    try {
      const dailyMedResponse = await fetch(`${PYTHON_SERVICE_URL}/dailymed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rxnorm_code: rxnormCode }),
      });

      if (dailyMedResponse.ok) {
        dailyMed = await dailyMedResponse.json();
      } else {
        console.warn(`DailyMed lookup returned ${dailyMedResponse.status} — falling back to Claude's extraction.`);
      }
    } catch (err) {
      // Service down, timeout, network error — all non-fatal. Fall back to Claude.
      console.warn("DailyMed lookup failed — falling back to Claude's extraction:", err);
    }
  } else {
    console.info("No rxnorm_code available — skipping DailyMed and using Claude's extraction.");
  }

  // Pick the winning data source, field by field.
  //
  // Per-field fallback, not all-or-nothing: an FDA label can carry an indications section
  // but no parsable dosage section (combination products frequently do). Mixing sources
  // per field gives the patient the best available answer for each one, so a partial label
  // still contributes what it has.
  const dailymedVerified = dailyMed.verified === true;

  const sourceData = {
    purpose: (dailymedVerified && dailyMed.purpose) || extraction.purpose,
    dosage: (dailymedVerified && dailyMed.dosage) || extraction.dosage,
    side_effects:
      dailymedVerified && dailyMed.side_effects && dailyMed.side_effects.length > 0
        ? dailyMed.side_effects
        : extraction.side_effects,
    warnings: (dailymedVerified && dailyMed.warnings) || null,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6 — NEW: second Claude call. Compile everything into plain language.
  // ───────────────────────────────────────────────────────────────────────────
  // See EXPLANATION_SYSTEM_PROMPT above for why this is a separate call. Claude is given
  // the chosen data and told to translate it — explanation only, no extraction.
  //
  // The redacted label text is included as context so the explanation can reflect the
  // actual instructions on this patient's bottle ("take with food") rather than only the
  // generic FDA text. It is safe to send because it has already been through Presidio.
  const explanationInput = [
    `MEDICATION NAME: ${extraction.medication_name}`,
    ``,
    `DATA SOURCE: ${dailymedVerified
      ? "Official FDA drug label (DailyMed). This text is authoritative but written for clinicians — translate it."
      : "Read from the patient's label by AI vision. No FDA label was available for this medication."}`,
    ``,
    `WHAT IT IS FOR:`,
    sourceData.purpose || "(not available)",
    ``,
    `DOSAGE INFORMATION:`,
    sourceData.dosage || "(not available)",
    ``,
    `KNOWN SIDE EFFECTS:`,
    sourceData.side_effects?.length ? sourceData.side_effects.join("; ") : "(not available)",
    ``,
    `WARNINGS:`,
    sourceData.warnings || "(none provided)",
    ``,
    `INSTRUCTIONS PRINTED ON THIS PATIENT'S LABEL (PHI already removed):`,
    extraction.instructions || "(not available)",
    ``,
    `REDACTED LABEL TEXT (for context — tags like [PERSON] and [DATE] are removed PHI, ignore them):`,
    redactedLabelText || "(not available)",
    ``,
    `Please return the explanation JSON as instructed.`,
  ].join("\n");

  // Start from the first-pass values. If the explanation call fails, these are what we
  // save — a plainer card, but still a complete one. Same fallback philosophy as step 5.
  let explanation: MedicationExplanation = {
    purpose: extraction.purpose,
    instructions: extraction.instructions,
    side_effects: extraction.side_effects,
  };

  try {
    const explanationMessage = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: EXPLANATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: explanationInput }],
    });

    const parsed = parseClaudeJson<MedicationExplanation>(textFromMessage(explanationMessage));

    // Only accept the result if it actually contains the fields we need — a malformed but
    // JSON-parseable response should not blank out the card.
    if (parsed?.purpose && parsed?.instructions) {
      explanation = {
        purpose: parsed.purpose,
        instructions: parsed.instructions,
        side_effects: Array.isArray(parsed.side_effects) && parsed.side_effects.length > 0
          ? parsed.side_effects
          : sourceData.side_effects,
      };
    }
  } catch (err) {
    console.warn("Explanation call failed — saving the first-pass extraction instead:", err);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 7 — Save to Supabase (same structure, plus dailymed_verified)
  // ───────────────────────────────────────────────────────────────────────────
  const { data: savedMedication, error: insertError } = await supabase
    .from("medications")
    .insert({
      user_id: user.id,                          // From verified JWT — never from client input
      medication_name: extraction.medication_name,
      rxnorm_code: rxnormCode,
      purpose: explanation.purpose,
      dosage: sourceData.dosage,                 // FDA label dosage when verified, else the bottle's
      instructions: explanation.instructions,
      side_effects: explanation.side_effects,
      raw_label_text: redactedLabelText,         // Presidio output only — the raw string is never stored
      image_url: null,                           // Still deferred; see Tier 2 notes in CLAUDE.md
      dailymed_verified: dailymedVerified,       // Drives the "FDA Verified" badge in the UI
    })
    .select()
    .single();

  if (insertError) {
    console.error("Supabase insert failed:", insertError);
    return NextResponse.json(
      { error: "Failed to save medication to the database. Please try again.", detail: insertError.message },
      { status: 500 }
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 8 — Return to the frontend (unchanged)
  // ───────────────────────────────────────────────────────────────────────────
  return NextResponse.json({ success: true, medication: savedMedication }, { status: 201 });
}
