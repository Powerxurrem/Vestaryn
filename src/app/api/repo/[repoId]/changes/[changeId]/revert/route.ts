import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { vault_write_text_new_version } from "@/lib/vault/writeVersion";
import { VAULT_BUCKET } from "@/lib/vault/buckets";

export async function POST(
  req: Request,
  context: { params: Promise<{ repoId: string; changeId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { repoId, changeId } = await context.params;

  const supabase = await supabaseServerComponent();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", { _repo_id: repoId });
  if (memErr) return new Response("Membership check failed", { status: 500 });
  if (!isMember) return new Response("Forbidden", { status: 403 });

  const supabaseAdmin = createSupabaseAdmin();

  const ch = await supabaseAdmin
    .from("repo_changes")
    .select("id, repo_id, status, base_state")
    .eq("id", changeId)
    .eq("repo_id", repoId)
    .single();

  if (ch.error || !ch.data) {
    return new Response(`Change not found: ${ch.error?.message ?? "unknown"}`, { status: 404 });
  }

  // allow revert from applied or verified_red (fail-safe)
  const st = String(ch.data.status);
  if (!(st === "applied" || st === "verified_red")) {
    return new Response(`Revert not allowed from status=${st}`, { status: 409 });
  }

  const baseState = ch.data.base_state as any;
  const files: any[] = Array.isArray(baseState?.files) ? baseState.files : [];
  if (files.length === 0) {
    return new Response("Missing base_state.files; cannot revert", { status: 400 });
  }

  const restored: any[] = [];
  const errors: any[] = [];

  for (const f of files) {
    try {
      const fileId = String(f.file_id);
      const storageKey = String(f.storage_key);

      const dl = await supabaseAdmin.storage.from(VAULT_BUCKET).download(storageKey);
      if (dl.error || !dl.data) throw new Error(`download failed: ${dl.error?.message ?? "unknown"}`);

      const ab = await dl.data.arrayBuffer();
      const content = new TextDecoder("utf-8", { fatal: false }).decode(ab);

      const w = await vault_write_text_new_version({
        supabase: supabaseAdmin,
        repoId,
        fileId,
        content,
        actor: "system",
        createdBy: user.id,
        note: `revert change ${changeId}`,
      });

      restored.push({ fileId, version: w.version });
    } catch (e: any) {
      errors.push({ file_id: f?.file_id, error: e?.message ?? String(e) });
    }
  }

  const nextStatus = errors.length === 0 ? "reverted" : "verified_red";

  await supabaseAdmin
    .from("repo_changes")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", changeId)
    .eq("repo_id", repoId);

  return Response.json({
    ok: errors.length === 0,
    requestId,
    repoId,
    changeId,
    restoredCount: restored.length,
    errorCount: errors.length,
    errors: errors.slice(0, 20),
    status: nextStatus,
  });
}