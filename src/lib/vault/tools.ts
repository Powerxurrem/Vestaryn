import { randomUUID, randomBytes } from "crypto";
import { VAULT_BUCKET } from "@/lib/vault/buckets";
import {
  normalizeForNoopCheck,
  sha256,
  confirmPhrase,
  confirmCreatePhrase,
  normalizePath,
  nameFromPath,
  inferTextMimeFromPath,
} from "@/lib/vault/utils";
const MAX_READ_BYTES = 200 * 1024;

export async function fileExistsByPath(supabase: any, repoId: string, path: string) {
  const { data, error } = await supabase
    .from("repo_files")
    .select("id")
    .eq("repo_id", repoId)
    .eq("path", path)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`fileExistsByPath failed: ${error.message}`);
  return Boolean(data?.id);
}

export function parseVersionFromKey(key: string | null | undefined) {
  const k = key || "";
  const m = k.match(/\/v(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

export function isTextMime(mime: string | null | undefined) {
  const m = (mime || "").toLowerCase();
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m.endsWith("+json") ||
    m === "application/xml" ||
    m.endsWith("+xml") ||
    m === "application/yaml" ||
    m === "application/x-yaml" ||
    m === "application/toml" ||
    m === "application/javascript" ||
    m === "text/javascript" ||
    m === "application/typescript" ||
    m === "application/x-typescript"
  );
}

export async function resolveFileIdByPathOrName(supabase: any, repoId: string, wanted: string) {
  wanted = (wanted || "").trim();
  wanted = wanted.replace(/^path:\s*/i, "").replace(/^name:\s*/i, "").trim();
  wanted = wanted.replace(/^["'`]+|["'`]+$/g, "").trim();
  wanted = wanted.replace(/^\*\*|\*\*$/g, "").replace(/^\*|\*$/g, "").trim();

  if (!wanted) return null;

  // 1) path exact (authoritative)
  const pathRes = await supabase
    .from("repo_files")
    .select("id, path, name, created_at")
    .eq("repo_id", repoId)
    .eq("path", wanted)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pathRes.error) {
    throw new Error(`resolve(path) failed: ${pathRes.error.message}`);
  }
  if (pathRes.data?.id) return pathRes.data.id;

  // 2) name exact (only valid if unique among active files)
  const nameRes = await supabase
    .from("repo_files")
    .select("id, path, name, created_at")
    .eq("repo_id", repoId)
    .eq("name", wanted)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(2);

  if (nameRes.error) {
    throw new Error(`resolve(name) failed: ${nameRes.error.message}`);
  }

  const matches = nameRes.data ?? [];

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length > 1) {
    const paths = matches.map((m: any) => m.path).filter(Boolean);
    throw new Error(
      `Multiple active files named "${wanted}" exist. Use full path instead. Matches: ${paths.join(", ")}`
    );
  }

  return null;
}

export async function vault_list_files(supabase: any, repoId: string) {
  console.log("[vault_list_files] ENTER", { repoId });

  const { data, error } = await supabase
    .from("repo_files")
    .select("path, name, mime") // ✅ minimal
    .eq("repo_id", repoId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.log("[vault_list_files] select error:", error.message);
    throw new Error(`vault_list_files failed: ${error.message}`);
  }

  const files = (data ?? []).map((f: any) => ({
    path: String(f.path ?? ""),
    name: String(f.name ?? ""),
    mime: String(f.mime ?? ""),
  }));

  console.log("[vault_list_files] rows:", files.length);
  return { files };
}

export async function vault_read_text(supabase: any, repoId: string, fileRef: string) {
  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  let row: any = null;

  if (isUuid(fileRef)) {
    const { data, error } = await supabase
      .from("repo_files")
      .select(
        "id, repo_id, path, name, mime, size_bytes, storage_key, deleted_at, created_at"
      )
      .eq("repo_id", repoId)
      .eq("id", fileRef)
      .maybeSingle();

    if (error) throw new Error(`vault_read_text metadata failed: ${error.message}`);
    row = data;
  } else {
    const id = await resolveFileIdByPathOrName(supabase, repoId, fileRef);
    if (!id) throw new Error("File not found (by name/path)");

    const { data, error } = await supabase
      .from("repo_files")
      .select(
        "id, repo_id, path, name, mime, size_bytes, storage_key, deleted_at, created_at"
      )
      .eq("repo_id", repoId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`vault_read_text metadata failed: ${error.message}`);
    row = data;
  }

  if (!row) throw new Error("File not found");
  if (row.deleted_at) throw new Error("File not found");

  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");
  if ((row.size_bytes ?? 0) > MAX_READ_BYTES) throw new Error(`File too large (>${MAX_READ_BYTES} bytes)`);
  if (!row.storage_key) throw new Error("Missing storage_key");

  const { data: blob, error: dlErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .download(row.storage_key);

  if (dlErr) throw new Error(`vault_read_text download failed: ${dlErr.message}`);
  if (!blob) return { id: row.id, path: row.path, name: row.name, mime: row.mime, content: "" };

  const ab = await blob.arrayBuffer();
  if (ab.byteLength > MAX_READ_BYTES) throw new Error(`Downloaded bytes too large (>${MAX_READ_BYTES} bytes)`);

  const text = new TextDecoder("utf-8", { fatal: false }).decode(ab);
  return { id: row.id, path: row.path, name: row.name, mime: row.mime, content: text };
}

export async function vault_propose_write(
  supabase: any,
  repoId: string,
  fileId: string,
  newContent: string
) {
  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, size_bytes, storage_key, version")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .maybeSingle();

  if (error) throw new Error(`vault_propose_write metadata failed: ${error.message}`);
  if (!row) throw new Error("File not found");
  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");

  const current = await vault_read_text(supabase, repoId, fileId);

  const normalizeNoopText = (text: string) =>
    String(text ?? "").replace(/\r\n/g, "\n").trim();

  const currentNorm = normalizeNoopText(current.content);
  const nextNorm = normalizeNoopText(newContent);

  const prevHash = sha256(currentNorm);
  const nextHash = sha256(nextNorm);

  if (prevHash === nextHash) {
    throw new Error("__NOOP_PROPOSAL__");
  }

  const phrase = confirmPhrase(fileId, nextHash);

  return {
    fileId,
    path: row.path,
    name: row.name,
    mime: row.mime,
    prevHash,
    nextHash,
    confirm: phrase,
    content: newContent,
    bytes: Buffer.byteLength(newContent, "utf8"),
  };
}

export async function vault_propose_append(supabase: any, repoId: string, fileRef: string, appendText: string) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileRef);

  let fileId = fileRef;
  if (!isUuid) {
    const resolved = await resolveFileIdByPathOrName(supabase, repoId, fileRef);
    if (!resolved) throw new Error(`File not found by path/name: ${fileRef}`);
    fileId = resolved;
  }

  const current = await vault_read_text(supabase, repoId, fileId);
  const base = current.content ?? "";

  const cleanedLines = String(appendText ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (cleanedLines.length === 0) {
    throw new Error("vault_propose_append produced empty append content after normalization");
  }

  const cleanedAppend = `${cleanedLines.join("\n")}\n`;
  const glue = base.length === 0 ? "" : base.endsWith("\n") ? "" : "\n";
  const newContent = base + glue + cleanedAppend;

  try {
    const proposal = await vault_propose_write(supabase, repoId, fileId, newContent);
    (proposal as any).meta = {
      ...(proposal as any).meta,
      op: "append",
      appendPreview: cleanedAppend,
    };
    return proposal;
  } catch (e: any) {
    if (e?.message === "__NOOP_PROPOSAL__") {
      throw new Error("__NOOP_APPEND__");
    }
    throw e;
  }
}

/**
 * Propose creating a NEW text file (does not write).
 * Returns a normal proposal object + meta.op="create"
 */
export async function vault_propose_create(
  supabase: any,
  repoId: string,
  args: { path: string; content: string; mime?: string }
) {
  const path = normalizePath(args.path);
  if (!path) throw new Error("vault_propose_create missing path");

  const content = String(args.content ?? "");
  if (!content) throw new Error("vault_propose_create missing content");

  const rawMime = String(args.mime ?? "").trim();
  const mime =
    !rawMime || rawMime === "text/plain"
      ? inferTextMimeFromPath(path)
      : rawMime;
  if (!isTextMime(mime)) throw new Error("vault_propose_create: mime must be text-like");

  // Must not already exist
  const exists = await fileExistsByPath(supabase, repoId, path);
  if (exists) throw new Error(`File already exists at path: ${path}`);

  const fileId = typeof randomUUID === "function" ? randomUUID() : randomBytes(16).toString("hex");
  const prevHash = sha256(""); // deterministic "empty"
  const nextHash = sha256(content);
  const confirm = confirmCreatePhrase(fileId, nextHash);

  return {
    fileId,
    path,
    name: nameFromPath(path),
    mime,
    prevHash,
    nextHash,
    confirm,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    meta: {
      op: "create",
      path,
      mime,
    },
  };
}

export async function vault_apply_write(
  supabase: any,
  repoId: string,
  userId: string,
  userMessage: string,
  args: { fileId: string; content: string; prevHash: string; nextHash: string; confirm: string }
) {
  const { fileId, content, prevHash, nextHash, confirm } = args;

  const expected = confirmPhrase(fileId, nextHash);
  if (confirm !== expected) throw new Error("Bad confirm phrase");
  if (userMessage.trim() !== expected) throw new Error("User did not confirm apply");

  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, repo_id, path, name, mime, storage_key, version")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .maybeSingle();

  if (error) throw new Error(`vault_apply_write metadata failed: ${error.message}`);
  if (!row) throw new Error("File not found");
  if (!isTextMime(row.mime)) throw new Error("Not a text-readable mime");

  const current = await vault_read_text(supabase, repoId, fileId);
  const currentHash = sha256(normalizeForNoopCheck(current.content));

  if (currentHash === nextHash) {
    return {
      ok: true,
      fileId,
      path: row.path,
      version: typeof row.version === "number" ? row.version : parseVersionFromKey(row.storage_key),
      storage_key: row.storage_key,
      nextHash,
      confirm: expected,
      noop: true,
    };
  }

  if (currentHash !== prevHash) throw new Error("Stale proposal: file changed since proposal (hash mismatch)");

  const computedNextHash = sha256(normalizeForNoopCheck(content));
  if (computedNextHash !== nextHash) throw new Error("Proposed content hash mismatch");

  const baseVersion = typeof row.version === "number" ? row.version : parseVersionFromKey(row.storage_key);

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

  const upd = await supabase
    .from("repo_files")
    .update({
      storage_key: newKey,
      size_bytes: sizeBytes,
      mime: row.mime,
      version: nextVersion,
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
    actor: "user",
    created_by: userId,
    sha256: nextHash,
  });

  if (verInsert.error) {
    console.log("[vault_apply_write] repo_file_versions insert failed:", verInsert.error.message);
  }

  return {
    ok: true,
    fileId,
    path: row.path,
    version: nextVersion,
    storage_key: newKey,
    size_bytes: sizeBytes,
    nextHash,
    confirm: expected,
  };
}

/**
 * Apply creation proposal (writes v1 and inserts repo_files + repo_file_versions)
 */
export async function vault_apply_create(
  supabase: any,
  repoId: string,
  userId: string,
  userMessage: string,
  proposal: {
    fileId: string;
    path: string;
    name?: string;
    mime: string;
    content: string;
    prevHash: string;
    nextHash: string;
    confirm: string;
    meta?: any;
  }
) {
  const fileId = String(proposal.fileId || "").trim();
  const path = normalizePath(String(proposal.path || ""));
  const mime = String(proposal.mime || "text/plain");
  const content = String(proposal.content ?? "");
  const nextHash = String(proposal.nextHash || "");
  const confirm = String(proposal.confirm || "");
  
  console.log("[vault_apply_create start]", {
  repoId,
  fileId,
  path,
  mime,
  nextHash,
});

  if (!fileId) throw new Error("vault_apply_create missing fileId");
  if (!path) throw new Error("vault_apply_create missing path");
  if (!content) throw new Error("vault_apply_create missing content");
  if (!nextHash) throw new Error("vault_apply_create missing nextHash");

  const expected = confirmCreatePhrase(fileId, nextHash);
  if (confirm !== expected) throw new Error("Bad confirm phrase");
  if (userMessage.trim() !== expected) throw new Error("User did not confirm create");

  if (!isTextMime(mime)) throw new Error("vault_apply_create: mime must be text-like");

  // Re-check: path must still not exist
  const exists = await fileExistsByPath(supabase, repoId, path);
  if (exists) throw new Error(`Create failed: file already exists at path: ${path}`);

  // Validate hash matches content
  const computedNextHash = sha256(content);
  if (computedNextHash !== nextHash) throw new Error("Proposed content hash mismatch");

  const storageKey = `repos/${repoId}/${fileId}/v1`;
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const name = proposal.name ? String(proposal.name) : nameFromPath(path);

  // Insert metadata first (so file appears immediately)
  const { error: insErr } = await supabase.from("repo_files").insert({
    id: fileId,
    repo_id: repoId,
    path,
    name,
    mime,
    size_bytes: sizeBytes,
    storage_key: storageKey,
    version: 1,
    created_by: userId,
    updated_at: new Date().toISOString(),
  });

  if (insErr) throw new Error(`repo_files insert failed: ${insErr.message}`);

  console.log("[vault_apply_create inserted repo_files]", {
  repoId,
  fileId,
  path,
  storageKey,
  sizeBytes,
});

const { data: verifyRow, error: verifyErr } = await supabase
  .from("repo_files")
  .select("id, repo_id, path, name, mime, storage_key, version, deleted_at")
  .eq("repo_id", repoId)
  .eq("id", fileId)
  .maybeSingle();

console.log("[vault_apply_create verify]", {
  repoId,
  fileId,
  path,
  storageKey,
  verifyErr: verifyErr?.message ?? null,
  verifyRow,
});
  
  // Upload content (no upsert)
  const blob = new Blob([content], { type: mime });
  
  console.log("[vault_apply_create upload start]", {
  bucket: VAULT_BUCKET,
  storageKey,
  sizeBytes,
});
  
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storageKey, blob, { upsert: false, contentType: mime });

  if (upErr) {
    // rollback metadata row
    await supabase.from("repo_files").delete().eq("id", fileId).eq("repo_id", repoId);
    throw new Error(`Upload failed: ${upErr.message}`);
  }

console.log("[vault_apply_create upload ok]", {
  bucket: VAULT_BUCKET,
  storageKey,
});

console.log("[vault_apply_create upload_ok]", {
  repoId,
  fileId,
  path,
  storageKey,
  sizeBytes,
});
  // Version row
  const verInsert = await supabase.from("repo_file_versions").insert({
    file_id: fileId,
    version: 1,
    storage_key: storageKey,
    size_bytes: sizeBytes,
    mime,
    actor: "user",
    created_by: userId,
    sha256: nextHash,
  });

  if (verInsert.error) {
    console.log("[vault_apply_create] repo_file_versions insert failed:", verInsert.error.message);
  }

if (!verInsert.error) {
  console.log("[vault_apply_create version row ok]", {
    fileId,
    version: 1,
    storageKey,
  });
}

console.log("[vault_apply_create done]", {
  fileId,
  path,
  version: 1,
});

  return {
    ok: true,
    fileId,
    path,
    version: 1,
    storage_key: storageKey,
    size_bytes: sizeBytes,
    nextHash,
    confirm: expected,
  };
}
