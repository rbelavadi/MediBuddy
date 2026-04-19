import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

interface MedicationExtraction {
  medication_name: string;
  dosage: string;
  instructions: string;
  purpose: string;
  side_effects: string[];
  raw_label_text: string;
}

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

export async function POST(request: Request) {
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

  let extraction: MedicationExtraction;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
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

    const rawText = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    // Strip markdown code fences — Claude occasionally wraps JSON in ```json blocks.
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    extraction = JSON.parse(cleaned) as MedicationExtraction;
  } catch (err) {
    console.error("Claude extraction failed:", err);
    return NextResponse.json(
      { error: "Could not extract medication information from the image. Please ensure the label is clearly visible and try again." },
      { status: 422 }
    );
  }

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

  const { data: savedMedication, error: insertError } = await supabase
    .from("medications")
    .insert({
      user_id: user.id,                          // From verified JWT — never from client input
      medication_name: extraction.medication_name,
      rxnorm_code: rxnormCode,
      purpose: extraction.purpose,
      dosage: extraction.dosage,
      instructions: extraction.instructions,
      side_effects: extraction.side_effects,
      raw_label_text: extraction.raw_label_text, // PII stripped by prompt; Presidio redaction in Tier 2
      image_url: null,                           // Deferred until Presidio PII redaction is in place
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

  return NextResponse.json({ success: true, medication: savedMedication }, { status: 201 });
}
