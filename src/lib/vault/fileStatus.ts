import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type RepoFileStatus = "ok" | "pending" | "warn" | "error";

export type RepoFileStatusSource = "preverify" | "verify" | "manual" | "scan";

export async function setRepoFileStatus(
  repoId: string,
  fileId: string,
  status: RepoFileStatus,
  reason: string | null,
  source: RepoFileStatusSource
) {
  const supabase = createSupabaseAdmin();

  const { error } = await supabase
    .from("repo_file_status")
    .upsert(
      {
        repo_id: repoId,
        file_id: fileId,
        status,
        reason,
        source,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "repo_id,file_id",
      }
    );

  if (error) {
    console.error("[repo_file_status] upsert failed", {
      repoId,
      fileId,
      status,
      reason,
      source,
      error,
    });
  }
}

export async function getRepoFileStatuses(repoId: string) {
  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase
    .from("repo_file_status")
    .select("file_id, status, reason, source, updated_at")
    .eq("repo_id", repoId);

  if (error) {
    console.error("[repo_file_status] read failed", {
      repoId,
      error,
    });
    return {};
  }

  const out: Record<
    string,
    {
      status: RepoFileStatus;
      reason: string | null;
      source: RepoFileStatusSource | null;
      updated_at: string | null;
    }
  > = {};

  for (const row of data ?? []) {
    out[String(row.file_id)] = {
      status: row.status as RepoFileStatus,
      reason: row.reason ?? null,
      source: (row.source as RepoFileStatusSource | null) ?? null,
      updated_at: row.updated_at ?? null,
    };
  }

  return out;
}

export async function getRepoFileStatus(
  repoId: string,
  fileId: string
) {
  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase
    .from("repo_file_status")
    .select("status, reason, source, updated_at")
    .eq("repo_id", repoId)
    .eq("file_id", fileId)
    .maybeSingle();

  if (error) {
    console.error("[repo_file_status] single read failed", {
      repoId,
      fileId,
      error,
    });
    return null;
  }

  return data ?? null;
}