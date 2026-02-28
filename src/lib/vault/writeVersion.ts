import { createHash } from "crypto";

const VAULT_BUCKET = "vestaryn-files";

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseVersionFromKey(key: string | null | undefined) {
  const k = key || "";
  const m = k.match(/\/v(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

export async function vault_write_text_new_version(args: {
  supabase: any;                 // can be admin client
  repoId: string;
  fileId: string;
  content: string;
  mime?: string;
  actor: "user" | "assistant" | "system";
  createdBy?: string | null;
  note?: string | null;
}) {
  const { supabase, repoId, fileId, content, actor, createdBy, note } = args;

  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, storage_key, version")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .maybeSingle();

  if (error) throw new Error(`vault_write_text_new_version metadata failed: ${error.message}`);
  if (!row) throw new Error("File not found");

  const baseVersion =
    typeof row.version === "number" ? row.version : parseVersionFromKey(row.storage_key);

  let nextVersion = baseVersion + 1;
  let newKey = `repos/${repoId}/${fileId}/v${nextVersion}`;

  let uploaded = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    newKey = `repos/${repoId}/${fileId}/v${nextVersion}`;

    const blob = new Blob([content], { type: row.mime || "text/plain" });

    const { error: upErr } = await supabase.storage
      .from(VAULT_BUCKET)
      .upload(newKey, blob, { upsert: false, contentType: row.mime || "text/plain" });

    if (!upErr) {
      uploaded = true;
      break;
    }

    const msg = (upErr.message || "").toLowerCase();
    if (msg.includes("already exists")) {
      nextVersion += 1;
      continue;
    }

    throw new Error(`Upload failed: ${upErr.message}`);
  }

  if (!uploaded) throw new Error("Upload failed: version collision retry exhausted");

  const sizeBytes = Buffer.byteLength(content, "utf8");
  const nextHash = sha256(content);

  const upd = await supabase
    .from("repo_files")
    .update({
      storage_key: newKey,
      size_bytes: sizeBytes,
      mime: row.mime,
      version: nextVersion,
      sha256: nextHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (upd.error) throw new Error(`repo_files update failed: ${upd.error.message}`);

  const verInsert = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: nextVersion,
    storage_key: newKey,
    size_bytes: sizeBytes,
    mime: row.mime,
    actor,
    created_by: createdBy ?? null,
    note: note ?? null,
    sha256: nextHash,
  });

  if (verInsert.error) {
    throw new Error(`repo_file_versions insert failed: ${verInsert.error.message}`);
  }

  return {
    ok: true,
    fileId,
    path: row.path,
    version: nextVersion,
    storage_key: newKey,
    size_bytes: sizeBytes,
    sha256: nextHash,
  };
}