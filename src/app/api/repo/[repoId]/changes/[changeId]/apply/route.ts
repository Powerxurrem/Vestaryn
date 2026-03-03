import crypto from "crypto";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";      
import { vault_write_text_new_version } from "@/lib/vault/writeVersion";      

type BaseState = {
  files: Array<{
    file_id: string;
    path: string;
    version: number;
    storage_key: string;
    sha256: string | null;
    size_bytes: number;
  }>;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ repoId: string; changeId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { repoId, changeId } = await context.params;

  // 1) auth
  const supabase = await supabaseServerComponent();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // 2) membership gate (fail closed)
  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });
  if (memErr) return new Response("Membership check failed", { status: 500 });
  if (!isMember) return new Response("Forbidden", { status: 403 });

  const supabaseAdmin = createSupabaseAdmin();

  // 3) load change (server-authoritative)
  const ch = await supabaseAdmin
    .from("repo_changes")
    .select("id, repo_id, status, proposal, base_state")
    .eq("id", changeId)
    .eq("repo_id", repoId)
    .single();

  if (ch.error || !ch.data) {
    return new Response(`Change not found: ${ch.error?.message ?? "unknown"}`, {
      status: 404,
    });
  }

  if (ch.data.status !== "proposed") {
    return new Response(`Change not in proposed state (status=${ch.data.status})`, {
      status: 409,
    });
  }

  // 4) capture base_state (latest versions per alive file)
  const filesRes = await supabaseAdmin
    .from("repo_files")
    .select("id, path, deleted_at")
    .eq("repo_id", repoId);

  if (filesRes.error) {
    return new Response(`Failed to load repo_files: ${filesRes.error.message}`, {
      status: 500,
    });
  }

const alive = (filesRes.data ?? []).filter((f: any) => !f.deleted_at);
const fileIds = alive.map((f: any) => f.id);
const proposal = ch.data.proposal as any;
const baseState: BaseState = { files: [] };
const touchedSet = new Set<string>();   // <-- MOVE IT HERE (outside block)

if (fileIds.length) {
    const versRes = await supabaseAdmin
      .from("repo_file_versions")
      .select("file_id, version, storage_key, size_bytes, sha256")
      .in("file_id", fileIds)
      .order("file_id", { ascending: true })
      .order("version", { ascending: false });

    if (versRes.error) {
      return new Response(
        `Failed to load repo_file_versions: ${versRes.error.message}`,
        { status: 500 }
      );
    }

const VAULT_BUCKET = "vestaryn-files";

async function readTextFromStorage(supabaseAdmin: any, bucket: string, key: string) {
  const dl = await supabaseAdmin.storage.from(bucket).download(key);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "download failed");
  const ab = await dl.data.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(ab);
}


const touchedSet = new Set<string>();
const ops: any[] = Array.isArray(proposal?.ops) ? proposal.ops : [];

for (const op of ops) {
  const type = String(op?.type ?? "");
  const fileId = String(op?.fileId ?? "").trim();
  if (!fileId) throw new Error("proposal op missing fileId");

  if (type === "overwrite_text") {
    const content = String(op?.content ?? "");
    await vault_write_text_new_version({
      supabase: supabaseAdmin,
      repoId,
      fileId,
      content,
      actor: "assistant",
      createdBy: user.id,
      note: `change ${changeId} apply overwrite_text`,
    });
    touchedSet.add(fileId);
    continue;
  }

  if (type === "append_text") {
    const append = String(op?.content ?? "");
    // get current latest from repo_files.storage_key
    const meta = await supabaseAdmin
      .from("repo_files")
      .select("storage_key, mime")
      .eq("repo_id", repoId)
      .eq("id", fileId)
      .single();

    if (meta.error || !meta.data?.storage_key) throw new Error("append_text: missing storage_key");

    const current = await readTextFromStorage(supabaseAdmin, VAULT_BUCKET, meta.data.storage_key);
    const glue = current.length === 0 ? "" : current.endsWith("\n") ? "" : "\n";
    const content = current + glue + append;

    await vault_write_text_new_version({
      supabase: supabaseAdmin,
      repoId,
      fileId,
      content,
      actor: "assistant",
      createdBy: user.id,
      note: `change ${changeId} apply append_text`,
    });
    touchedSet.add(fileId);
    continue;
  }

  throw new Error(`Unknown proposal op type: ${type}`);
}

    // pick latest per file_id
    const latest = new Map<string, any>();
    for (const v of (versRes.data ?? []) as any[]) {
      if (!latest.has(v.file_id)) latest.set(v.file_id, v);
    }


    
    baseState.files = alive
      .map((f: any) => {
        const v = latest.get(f.id);
        if (!v) return null;
        return {
          file_id: f.id,
          path: f.path,
          version: Number(v.version),
          storage_key: String(v.storage_key),
          sha256: v.sha256 ? String(v.sha256) : null,
          size_bytes: Number(v.size_bytes ?? 0),
        };
      })
      .filter(Boolean) as any;
  }

async function readTextFromStorage(supabaseAdmin: any, bucket: string, key: string) {
  const dl = await supabaseAdmin.storage.from(bucket).download(key);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "download failed");
  const ab = await dl.data.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(ab);
}

  // 5) persist base_state + mark applied
  const up = await supabaseAdmin
    .from("repo_changes")
    .update({
      base_state: baseState,
      status: "applied",
      updated_at: new Date().toISOString(),
    })
    .eq("id", changeId)
    .eq("repo_id", repoId);

  if (up.error) {
    return new Response(`Failed to update change: ${up.error.message}`, {
      status: 500,
    });
  }

  return Response.json({
    ok: true,
    requestId,
    repoId,
    changeId,
    capturedFiles: baseState.files.length,
    touchedFileIds: Array.from(touchedSet),
  });1
}