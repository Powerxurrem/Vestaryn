import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";

const KEYS = [
  "master-summary",
  "chamber-state",
  "path-tree",
  "ledger",
] as const;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await ctx.params;

  const supabase = await supabaseServerComponent();

  const rows = KEYS.map((key) => ({
    repo_id: repoId,
    key,
    content: "",
    meta: {},
  }));

  const { error } = await supabase
    .from("repo_memory_docs" as any)
    .upsert(rows, { onConflict: "repo_id,key", ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}