// app/api/analyze-medication/route.ts
//
// WHAT IS A NEXT.JS APP ROUTER API ROUTE?
// ----------------------------------------
// In Next.js App Router, any file named route.ts inside app/ becomes a real HTTP endpoint.
// You export named async functions matching HTTP methods: GET, POST, PUT, DELETE, etc.
// Next.js calls the matching function when a request hits that URL.
//
//   export async function POST(request: Request) { ... }
//       │                      └── The standard Web API Request object — same as in the browser
//       └── Next.js calls this function for every POST to /api/analyze-medication
//
// The function returns a Response (also the standard Web API type). We use NextResponse
// from next/server as a convenience wrapper that adds helper methods like .json().
//
// WHY THE ANTHROPIC KEY IS SERVER-SIDE ONLY
// ------------------------------------------
// This file runs exclusively on the server (Node.js), never in the browser. That's why
// we can safely read process.env.ANTHROPIC_API_KEY here — it has no NEXT_PUBLIC_ prefix,
// so Next.js never bundles it into the client JavaScript. If we called the Anthropic SDK
// from a Client Component instead, anyone could open DevTools → Network tab and see our key.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────────────

// This is the shape we expect Claude to return as JSON.
// Defining it as an interface gives us TypeScript autocompletion and catches
// shape mismatches at compile time rather than at 2am in production.
interface MedicationExtraction {
  medication_name: string;
  dosage: string;
  instructions: string;
  purpose: string;
  side_effects: string[];  // Array, not a comma-separated string — easier to render as a list
  raw_label_text: string;
}

// ─── Claude System Prompt ────────────────────────────────────────────────────
//
// The system prompt is the most important piece of this whole route. It is the
// "instruction manual" we hand to Claude before showing it any image. Small changes
// here can dramatically change output quality — experiment with the tone section.
//
// WHY A SEPARATE CONSTANT?
// Keeping the prompt out of the function body makes it easy to version, test, and
// tweak without touching any logic code.

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

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // WHAT IS FORMDATA?
  // -----------------
  // FormData is a browser/web standard for sending files over HTTP.
  // Regular JSON (application/json) can only carry text — you can't put binary image
  // data inside a JSON string without base64-encoding it (which inflates size by ~33%).
  // FormData (multipart/form-data) is designed for mixed text + binary payloads.
  // The frontend will append both the image file and any metadata fields to a FormData
  // object, and the browser handles the encoding automatically.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // WHY THIS CAN FAIL: The request body might not be multipart/form-data
    // (e.g., someone called this endpoint with JSON instead of FormData).
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

  // ── Step 1: Get the authenticated user server-side ──────────────────────────
  //
  // WHY WE DO THIS SERVER-SIDE AND NOT TRUST THE FRONTEND
  // -------------------------------------------------------
  // The frontend could pass a user_id in the form body, but we must never trust it.
  // A malicious user could forge that field and save medications under someone else's
  // account. Instead, we extract the user_id from the auth session token that Supabase
  // issues — the server verifies the cryptographic signature of that token, so it
  // cannot be faked.
  //
  // SUPABASE SERVER CLIENT vs LIB/SUPABASE.TS
  // ------------------------------------------
  // We create a fresh Supabase client here using the service role key isn't needed —
  // we use the same anon key but pass the user's Authorization header so Supabase
  // knows who is making the request. This is the correct pattern for App Router routes.

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Missing Authorization header. You must be logged in to analyze a medication." },
      { status: 401 }
    );
  }

  // Create a per-request Supabase client that operates as the calling user,
  // not as an anonymous visitor. The JWT from the Authorization header tells
  // Supabase which user this is, and RLS policies enforce what they can access.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    // WHY THIS CAN FAIL: The JWT token may be expired, malformed, or from a different project.
    return NextResponse.json(
      { error: "Invalid or expired session. Please log in again." },
      { status: 401 }
    );
  }

  // ── Step 2: Convert the image to base64 for Claude ──────────────────────────
  //
  // Claude's vision API accepts images as base64-encoded strings.
  // We read the File as an ArrayBuffer (raw bytes), then convert to base64.
  // The media type tells Claude what format the image is in so it decodes correctly.

  const imageBuffer = await imageFile.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const mediaType = (imageFile.type || "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  // ── Step 3: Call Claude Haiku with the image ─────────────────────────────────
  //
  // We use claude-haiku-4-5 (not Sonnet or Opus) because:
  //   - It supports vision (image understanding)
  //   - It is the fastest and cheapest Claude model
  //   - Extracting structured data from a pill bottle label doesn't require deep reasoning
  // Tradeoff: if labels are very unusual or handwritten, Haiku may struggle where Sonnet would not.

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY, // Server-side only — never exposed to the browser
  });

  let extraction: MedicationExtraction;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024, // Enough for the JSON response; Haiku is concise by default
      system: MEDICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              // This text message accompanies the image.
              // Being explicit helps Claude focus — without it, the model might summarize
              // the image rather than extract structured fields.
              type: "text",
              text: "Please analyze this medication label and return the JSON as instructed.",
            },
          ],
        },
      ],
    });

    // Claude returns an array of content blocks. We want the first text block.
    const rawText = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    // WHY THIS CAN FAIL: Despite our prompt, Claude occasionally wraps JSON in markdown
    // code fences (```json ... ```) especially on edge cases. We strip those defensively.
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    extraction = JSON.parse(cleaned) as MedicationExtraction;
  } catch (err) {
    // WHY THIS CAN FAIL:
    //   - Claude returned something that isn't valid JSON (rare but possible on confusing images)
    //   - The Anthropic API was temporarily unavailable
    //   - We hit a rate limit (Haiku has generous limits but they exist)
    console.error("Claude extraction failed:", err);
    return NextResponse.json(
      {
        error:
          "Could not extract medication information from the image. " +
          "Please ensure the label is clearly visible and try again.",
      },
      { status: 422 }
    );
  }

  // ── Step 4: RxNorm Lookup ────────────────────────────────────────────────────
  //
  // WHAT IS RXNORM AND WHY DO WE NEED IT?
  // ---------------------------------------
  // RxNorm is a standardized drug naming system maintained by the US National Library of Medicine.
  // Every approved drug gets a unique numeric code called an RxCUI (RxNorm Concept Unique Identifier).
  //
  // WHY THIS MATTERS FOR INTERACTION CHECKING (Tier 5):
  // Drug names in the real world are messy — "Tylenol", "acetaminophen", "APAP", and
  // "paracetamol" all refer to the same molecule. Interaction databases use RxCUI codes,
  // not free-text names. By normalizing to RxCUI here, we make the Tier 5 interaction
  // checker reliable regardless of how the label spells the drug name.

  let rxnormCode: string | null = null;

  try {
    const rxnormUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(
      extraction.medication_name
    )}`;
    const rxnormResponse = await fetch(rxnormUrl);

    if (rxnormResponse.ok) {
      const rxnormData = await rxnormResponse.json();
      // The RxNorm API nests the result: idGroup → rxnormId → array of codes.
      // We take the first one if it exists. Multiple codes can appear for combination drugs.
      const codes: string[] | undefined =
        rxnormData?.idGroup?.rxnormId;
      rxnormCode = codes?.[0] ?? null;
    }
    // WHY WE DON'T THROW ON FAILURE:
    // RxNorm not finding a match (or being temporarily unavailable) is not a critical error.
    // The medication data is still useful without it. We save null and move on.
    // Tier 5 will simply skip the interaction check for medications without a code.
  } catch {
    // Network error calling the RxNorm API — safe to ignore, rxnormCode stays null.
    console.warn(
      `RxNorm lookup failed for "${extraction.medication_name}" — saving with null rxnorm_code.`
    );
  }

  // ── Step 5: Save to Supabase ─────────────────────────────────────────────────
  //
  // IMAGE URL IS INTENTIONALLY NULL
  // ---------------------------------
  // We are not storing the image yet. Reason: before storing any image of a prescription,
  // we should run it through a PII (personally identifiable information) redaction step
  // to black out the patient's name, DOB, address, and doctor details.
  // We plan to use Microsoft Presidio (an open-source NLP tool) for this in a later tier.
  // Storing the raw unredacted image now would be a privacy risk for a health app.
  //
  // RAW_LABEL_TEXT PII NOTE
  // ------------------------
  // The Claude system prompt instructs the model to omit personal identifiers from
  // raw_label_text. In a later tier we will additionally run this text through Presidio
  // as a second layer of protection before storage — AI models can miss edge cases.

  const { data: savedMedication, error: insertError } = await supabase
    .from("medications")
    .insert({
      user_id: user.id,                           // Verified server-side — never from the client
      medication_name: extraction.medication_name,
      rxnorm_code: rxnormCode,                    // null if lookup failed or found nothing
      purpose: extraction.purpose,
      dosage: extraction.dosage,
      instructions: extraction.instructions,
      side_effects: extraction.side_effects,
      raw_label_text: extraction.raw_label_text,  // PII stripped by Claude; Presidio TBD
      image_url: null,                            // Intentionally null — see comment above
    })
    .select()
    .single();

  if (insertError) {
    // WHY THIS CAN FAIL:
    //   - The medications table doesn't exist yet (SQL schema not run in dashboard)
    //   - RLS policy rejected the insert (user_id mismatch — shouldn't happen here but worth catching)
    //   - Supabase is temporarily unavailable
    console.error("Supabase insert failed:", insertError);
    return NextResponse.json(
      {
        error: "Failed to save medication to the database. Please try again.",
        detail: insertError.message,
      },
      { status: 500 }
    );
  }

  // ── Step 6: Return the saved record to the frontend ──────────────────────────
  //
  // We return the full saved record (including the generated id and created_at)
  // rather than just the extraction, so the frontend can immediately display it
  // and link to it without a second round-trip to the database.

  return NextResponse.json(
    {
      success: true,
      medication: savedMedication,
    },
    { status: 201 } // 201 Created — more accurate than 200 OK for a new resource
  );
}
