import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type RepoFileStatus = "ok" | "pending" | "warn" | "error";

export type RepoFileStatusSource = "preverify" | "verify" | "manual";

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