import { ensureSacredMemoryFile, ensureUserProfileFile } from "@/lib/chamber/memory";
import { inferRepoProfile } from "@/lib/chamber/repoInference";
import { SACRED_PATH, USER_PROFILE_PATH } from "@/lib/chamber/constants";
import { vault_read_text } from "@/lib/vault/tools";

export async function buildChatContext(args: {
  supabase: any;
  repoId: string;
  userId: string;
  content: string;
  tierPolicy: any;
}) {
  const { supabase, repoId, userId, content, tierPolicy } = args;

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

  let sacredText = "";
  try {
    const sacred = await vault_read_text(supabase, repoId, SACRED_PATH);
    sacredText = sacred.content || "";
  } catch (e: any) {
    sacredText = "";
    console.log("[sacred] read failed:", e?.message);
  }

  let profileText = "";
  try {
    const profile = await vault_read_text(supabase, repoId, USER_PROFILE_PATH);
    profileText = profile.content || "";
  } catch (e: any) {
    profileText = "";
    console.log("[profile] read failed:", e?.message);
  }

  let masterSummary = "";
  let chamberState = "";
  let pathTree = "";
  let ledger = "";

  try {
    const { data: memDocs } = await supabase
      .from("repo_memory_docs")
      .select("key, content")
      .eq("repo_id", repoId);

    for (const d of memDocs ?? []) {
      if (d.key === "master-summary") masterSummary = d.content ?? "";
      if (d.key === "chamber-state") chamberState = d.content ?? "";
      if (d.key === "path-tree") pathTree = d.content ?? "";
      if (d.key === "ledger") ledger = d.content ?? "";
    }
  } catch (e: any) {
    console.log("[memory] load failed:", e?.message);
  }

  const insertUserPromise = supabase.from("repo_messages").insert({
    repo_id: repoId,
    user_id: userId,
    role: "user",
    content,
  });

  const historyPromise = supabase
    .from("repo_messages")
    .select("role, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(16);

  const [{ data: history }, insertResult] = await Promise.all([
    historyPromise,
    insertUserPromise,
  ]);

  if (insertResult.error) {
    throw new Error("Failed to save message");
  }

  const orderedHistory = (history ?? []).slice().reverse();
  const cleanedHistory = orderedHistory.filter((m: any) => {
    if (m.role !== "assistant") return true;

    const text = String(m.content || "").trim();
    return text.startsWith("[Observation]");
  });

  const sacredBlock = sacredText.trim()
    ? `=== SACRED_MEMORY (authoritative, user-confirmed) ===\n${sacredText.trim()}\n=== END SACRED_MEMORY ===`
    : `=== SACRED_MEMORY ===\n(empty)\n=== END SACRED_MEMORY ===`;

  const profileBlock = profileText.trim()
    ? `=== USER_PROFILE (non-personal preferences + observed level) ===\n${profileText.trim()}\n=== END USER_PROFILE ===`
    : `=== USER_PROFILE ===\n(empty)\n=== END USER_PROFILE ===`;

  const masterBlock = masterSummary.trim()
    ? `=== MASTER_MEMORY ===\n${masterSummary.trim()}\n=== END MASTER_MEMORY ===`
    : `=== MASTER_MEMORY ===\n(empty)\n=== END MASTER_MEMORY ===`;

  const chamberBlock = chamberState.trim()
    ? `=== CHAMBER_STATE ===\n${chamberState.trim()}\n=== END CHAMBER_STATE ===`
    : `=== CHAMBER_STATE ===\n(empty)\n=== END CHAMBER_STATE ===`;

  const treeBlock = pathTree.trim()
    ? `=== PATH_TREE ===\n${pathTree.trim()}\n=== END PATH_TREE ===`
    : `=== PATH_TREE ===\n(empty)\n=== END PATH_TREE ===`;

  const ledgerBlock = ledger.trim()
    ? `=== ENGINEERING_LEDGER ===\n${ledger.trim()}\n=== END ENGINEERING_LEDGER ===`
    : `=== ENGINEERING_LEDGER ===\n(empty)\n=== END ENGINEERING_LEDGER ===`;

  const membershipBlock =
    `=== MEMBERSHIP_TIER (hard caps, server-enforced) ===\n` +
    `tier: ${tierPolicy.tier}\n` +
    `model: ${tierPolicy.model}\n` +
    `max_output_tokens: ${tierPolicy.output.maxOutputTokens}\n` +
    `max_tool_rounds: ${tierPolicy.tools.maxToolRounds}\n` +
    `capabilities:\n` +
    `- export: ${tierPolicy.capabilities.allowExport}\n` +
    `- multi_export: ${tierPolicy.capabilities.allowMultiExport}\n` +
    `- create_files: ${tierPolicy.capabilities.allowCreateFiles}\n` +
    `- create_trees: ${tierPolicy.capabilities.allowCreateTrees}\n` +
    `RULE: These caps override USER_PROFILE preferences.\n` +
    `=== END MEMBERSHIP_TIER ===`;

  return {
    filePaths,
    inference,
    sacredText,
    profileText,
    masterSummary,
    chamberState,
    pathTree,
    ledger,
    orderedHistory,
    cleanedHistory,
    sacredBlock,
    profileBlock,
    masterBlock,
    chamberBlock,
    treeBlock,
    ledgerBlock,
    membershipBlock,
  };
}