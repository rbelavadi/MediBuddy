import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MedicationRow {
  medication_name: string;
  purpose: string | null;
  dosage: string | null;
  instructions: string | null;
  side_effects: string[] | null;
  rxnorm_code: string | null;
}

function buildSystemPrompt(medications: MedicationRow[]): string {
  const medContext =
    medications.length === 0
      ? "The patient has not uploaded any medications yet."
      : medications
          .map((m) => {
            const parts = [
              `Medication: ${m.medication_name}`,
              m.dosage         ? `  Dosage: ${m.dosage}`            : null,
              m.purpose        ? `  Purpose: ${m.purpose}`          : null,
              m.instructions   ? `  Instructions: ${m.instructions}`: null,
              m.side_effects?.length
                ? `  Side effects: ${m.side_effects.join(", ")}`    : null,
              m.rxnorm_code    ? `  RxNorm code: ${m.rxnorm_code}`  : null,
            ]
              .filter(Boolean)
              .join("\n");
            return parts;
          })
          .join("\n\n");

  return `You are MediBuddy, a warm and knowledgeable medication assistant designed to help elderly patients understand their medications.

PATIENT'S CURRENT MEDICATION LIST:
${medContext}

YOUR ROLE:
- Answer questions about any medications on the patient's list
- Explain medical terms in plain, friendly language
- Flag potential interactions between medications in the list if asked or if relevant
- Always be warm, patient, and clear — as if speaking to an 80-year-old who may be anxious about their health
- Use short sentences and simple words. If you use a medical term, explain it in parentheses immediately after

IMPORTANT BOUNDARIES:
- You are NOT a doctor. For any medical decisions, dosage changes, or symptoms, always recommend consulting their physician or pharmacist
- Only discuss topics related to the patient's medications and general health questions related to those medications
- Politely decline questions unrelated to health and medications
- Never alarm the patient — frame side effects and interactions calmly, as things to be aware of and discuss with their doctor

TONE: Warm, reassuring, clear. Like a kind neighbor who happens to be a pharmacist.`;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Scope the Supabase client to the calling user via their JWT.
  // We fetch medications server-side so the client can never inject fake medication data
  // into the system prompt — the AI context must come from the verified database record.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  let messages: Message[];
  try {
    ({ messages } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { data: medications } = await supabase
    .from("medications")
    .select("medication_name, purpose, dosage, instructions, side_effects, rxnorm_code")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const systemPrompt = buildSystemPrompt((medications as MedicationRow[]) ?? []);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Stream the response so text appears word-by-word rather than after a full delay.
  // For elderly users who read more slowly, streaming lets them start reading immediately
  // rather than staring at a loading indicator for several seconds.
  const stream = anthropic.messages.stream({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    // We send the full conversation history on every request because Claude has no memory
    // between API calls — each call is stateless. Sending the history each time is how
    // we simulate a continuous conversation. The client holds the history in React state
    // and includes it in every request payload.
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
