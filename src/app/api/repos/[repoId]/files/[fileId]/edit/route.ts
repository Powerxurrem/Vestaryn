import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ repoId: string; fileId: string }> };

function isTextLike(mime: string) {
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-typescript",
    ].includes(mime)
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  const supabase = await supabaseRouteHandler();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const content: string | undefined = body?.content;
  const baseVersion: number | undefined = body?.base_version;
  const note: string | undefined = body?.note;

  if (typeof content !== "string") {
    return NextResponse.json({ error: "missing content" }, { status: 400 });
  }
  if (typeof baseVersion !== "number") {
    return NextResponse.json({ error: "missing base_version" }, { status: 400 });
  }

  // 1) Load file metadata (RLS enforces access)
  const { data: file, error: fileErr } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, storage_key, deleted_at")
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .maybeSingle();

  if (fileErr) return NextResponse.json({ error: fileErr.message }, { status: 400 });
  if (!file || file.deleted_at) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isTextLike(file.mime)) return NextResponse.json({ error: "file not editable" }, { status: 400 });

  // 2) Get current latest version
  const { data: latest, error: latestErr } = await supabase
    .from("repo_file_versions")
    .select("version")
    .eq("file_id", fileId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 400 });

  const current = latest?.version ?? 1;
  if (current !== baseVersion) {
    return NextResponse.json(
      { error: "conflict", current_version: current },
      { status: 409 }
    );
  }

  const newVersion = current + 1;
  const storageKey = `repos/${repoId}/${fileId}/v${newVersion}`;

  const bytes = new TextEncoder().encode(content);

  // 3) Upload new content
  const up = await supabase.storage.from("vestaryn-files").upload(storageKey, bytes, {
    contentType: file.mime,
    upsert: false,
  });

  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 });

  // 4) Insert version row
  const { error: verErr } = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: newVersion,
    actor: "user",
    note: note ?? "edit",
    storage_key: storageKey,
    size_bytes: bytes.byteLength,
  });

  if (verErr) {
    await supabase.storage.from("vestaryn-files").remove([storageKey]);
    return NextResponse.json({ error: verErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, version: newVersion });
}
