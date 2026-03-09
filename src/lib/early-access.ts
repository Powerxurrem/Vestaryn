import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function isEarlyAccessAllowed(email: string | null | undefined) {
  if (!email) return false;

  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase
    .from("early_access_users")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error("[early_access] whitelist check failed", error);
    return false;
  }

  return !!data;
}