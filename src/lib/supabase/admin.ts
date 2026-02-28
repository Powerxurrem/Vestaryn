import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!service) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  return createClient(url, service, {
    auth: { persistSession: false },
  });
}