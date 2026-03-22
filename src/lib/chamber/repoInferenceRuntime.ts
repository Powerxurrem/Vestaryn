import { inferRepoProfile } from "@/lib/chamber/repoInference";

export async function loadRepoInference(args: {
  supabase: any;
  repoId: string;
}) {
  const { supabase, repoId } = args;

  const { data: repoFiles, error: repoFilesErr } = await supabase
    .from("repo_files")
    .select("path")
    .eq("repo_id", repoId)
    .is("deleted_at", null);

  if (repoFilesErr) {
    console.log("[repo_inference] repo file load failed:", repoFilesErr.message);
  }

  const filePaths = (repoFiles ?? [])
    .map((f: any) => String(f.path ?? "").trim())
    .filter(Boolean);

  const inference = inferRepoProfile(filePaths);

  console.log("[repo_inference]", {
    repoId,
    fileCount: filePaths.length,
    inference,
  });

  return {
    filePaths,
    inference,
  };
}