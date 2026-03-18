import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const email = normalizeEmail(formData.get("email"));
    const useCase = normalizeText(formData.get("use_case"));
    const source = normalizeText(formData.get("source")) ?? "homepage";

    if (!email || !email.includes("@")) {
      return NextResponse.redirect(new URL("/?waitlist=invalid#early-access", req.url));
    }

    const supabase = await supabaseServerComponent();

    const { data: existing, error: lookupError } = await supabase
      .from("waitlist_signups")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      console.error("[waitlist] lookup failed:", lookupError.message);
      return NextResponse.redirect(new URL("/?waitlist=error#early-access", req.url));
    }

    if (!existing) {
      const { error: insertError } = await supabase.from("waitlist_signups").insert({
        email,
        use_case: useCase,
        source,
      });

      if (insertError) {
        console.error("[waitlist] insert failed:", insertError.message);
        return NextResponse.redirect(new URL("/?waitlist=error#early-access", req.url));
      }
    }

    return NextResponse.redirect(new URL("/?waitlist=success#early-access", req.url));
  } catch (error) {
    console.error("[waitlist] unexpected error:", error);
    return NextResponse.redirect(new URL("/?waitlist=error#early-access", req.url));
  }
}