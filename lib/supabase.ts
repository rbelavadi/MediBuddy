// lib/supabase.ts
//
// WHY THIS FILE EXISTS — THE SINGLETON PATTERN
// ---------------------------------------------
// We could call `createClient(...)` inside every component that needs the database,
// but that would create a new TCP connection to Supabase on each render — wasteful
// and potentially rate-limited. Instead, we create ONE shared client here and import
// it wherever it's needed. This is called the "singleton pattern": one instance,
// shared everywhere.
//
// WHY NEXT_PUBLIC_ PREFIX?
// -------------------------
// Next.js has two environments: the server (Node.js) and the browser (client).
// Variables prefixed with NEXT_PUBLIC_ are bundled into the browser JavaScript.
// The Supabase URL and anon key are SAFE to expose because:
//   - The anon key is intentionally public — Row Level Security (see Supabase dashboard)
//     enforces what the user can actually read/write, not the key itself.
//   - The URL is just an address; knowing it alone gives no access.
//
// The Anthropic API key has NO such prefix — it would give full Claude API access to
// anyone who opened DevTools, so it must stay on the server only.

import { createClient } from "@supabase/supabase-js";

// These environment variables are validated at startup. If either is missing,
// we throw immediately rather than getting a cryptic error deep inside a component.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
      "Check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "are set in your .env.local file."
  );
}

// The exported client is what every other file imports.
// Tradeoff: a single shared client works perfectly for a browser app. If we ever
// needed per-request auth on the server (e.g., for SSR with user-specific data),
// we'd create a server-side client using the service-role key instead — but that's
// a Chunk 3+ concern.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
