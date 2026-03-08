import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await ctx.params;

  const supabase = await supabaseServerComponent();

  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "master-summary";

  const { data, error } = await supabase
    .from("repo_memory_docs" as any)
    .select("key, content, meta, updated_at")
    .eq("repo_id", repoId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    doc: data ?? { key, content: "", meta: {}, updated_at: null },
  });
}