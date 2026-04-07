import { NextResponse } from "next/server";
import { supabaseServerComponent } from "@/lib/supabase/server";
import { VAULT_BUCKET } from "@/lib/vault/buckets";
import { setRepoFileStatus, getRepoFileStatus } from "@/lib/vault/fileStatus";

export const runtime = "nodejs";

function extOf(path: string) {
  const p = String(path ?? "").toLowerCase().trim();
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx) : "";
}

function isTextScannableExt(ext: string) {
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".html",
    ".css",
    ".scss",
    ".json",
    ".bas",
    ".vba",
  ].includes(ext);
}

function normalizeLines(text: string) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function scanPythonText(content: string) {
  const text = normalizeLines(content).trim();

  if (!text) {
    return { status: "warn" as const, reason: "empty_python_file" };
  }

  try {
    // simulate basic syntax check using Function constructor equivalent
    // (not perfect, but catches MANY real issues)
    new Function(`return \`${text.replace(/`/g, "\\`")}\``);

    // additional simple checks
    if (/def\s+\w+\(.*$/.test(text) && !/:/.test(text)) {
      return { status: "error" as const, reason: "missing_colon" };
    }

    if (/^\s+[^#\n]/m.test(text) && !/def|class|if|for|while|try/.test(text)) {
      return { status: "warn" as const, reason: "suspicious_indentation" };
    }

    return { status: "ok" as const, reason: "python_syntax_likely_ok" };
  } catch {
    return { status: "error" as const, reason: "python_parse_error" };
  }
}

function scanMacroText(content: string) {
  const text = normalizeLines(content);
  const trimmed = text.trim();

  if (!trimmed) {
    return { status: "warn" as const, reason: "macro_empty_file" };
  }

  const subStarts = (text.match(/^\s*(Public\s+|Private\s+)?Sub\b/gim) ?? []).length;
  const subEnds = (text.match(/^\s*End\s+Sub\b/gim) ?? []).length;

  const fnStarts = (text.match(/^\s*(Public\s+|Private\s+)?Function\b/gim) ?? []).length;
  const fnEnds = (text.match(/^\s*End\s+Function\b/gim) ?? []).length;

  if (subStarts !== subEnds || fnStarts !== fnEnds) {
    return { status: "error" as const, reason: "macro_block_mismatch" };
  }

  if (subStarts === 0 && fnStarts === 0) {
    return { status: "warn" as const, reason: "macro_missing_entrypoint" };
  }

  return { status: "ok" as const, reason: "macro_structure_ok" };
}

function scanGenericText(content: string) {
  const text = normalizeLines(content).trim();

  if (!text) {
    return { status: "warn" as const, reason: "empty_text_file" };
  }

  return { status: "warn" as const, reason: "text_file_not_deep_scanned_yet" };
}

function isScannablePath(path: string) {
  const p = String(path ?? "").toLowerCase().trim();
  if (!p) return false;

  return (
    p.endsWith(".ts") ||
    p.endsWith(".tsx") ||
    p.endsWith(".js") ||
    p.endsWith(".jsx") ||
    p.endsWith(".py") ||
    p.endsWith(".html") ||
    p.endsWith(".css") ||
    p.endsWith(".scss") ||
    p.endsWith(".json") ||
    p.endsWith(".bas") ||
    p.endsWith(".vba")
  );
}

async function readRepoFileText(
  supabase: any,
  repoId: string,
  fileId: string
): Promise<{ ok: true; content: string; path: string; mime: string | null } | { ok: false; reason: string }> {
  const { data: row, error } = await supabase
    .from("repo_files")
    .select("id, path, mime, storage_key")
    .eq("repo_id", repoId)
    .eq("id", fileId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.log("[scan_vault] repo_files lookup failed", {
      repoId,
      fileId,
      message: error.message,
    });
    return { ok: false, reason: "scan_read_failed" };
  }

  if (!row?.storage_key || !row?.path) {
    return { ok: false, reason: "scan_read_failed" };
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .download(String(row.storage_key));

  if (downloadErr || !blob) {
    console.log("[scan_vault] storage download failed", {
      repoId,
      fileId,
      storageKey: row.storage_key,
      message: downloadErr?.message ?? "missing blob",
    });
    return { ok: false, reason: "scan_read_failed" };
  }

  const content = await blob.text();

  return {
    ok: true,
    content: String(content ?? ""),
    path: String(row.path),
    mime: row.mime ?? null,
  };
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
  const supabase = await supabaseServerComponent();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: isMember, error: memErr } = await supabase.rpc(
    "is_repo_member",
    { _repo_id: repoId }
  );

  if (memErr) {
    return new NextResponse("Membership check failed", { status: 500 });
  }

  if (!isMember) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data: files, error: filesErr } = await supabase
    .from("repo_files")
    .select("id, path, mime")
    .eq("repo_id", repoId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (filesErr) {
    return new NextResponse(`File lookup failed: ${filesErr.message}`, {
      status: 500,
    });
  }

  const rows = files ?? [];

  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;
  let scanned = 0;

  for (const file of rows) {
  const fileId = String(file.id ?? "");
  const path = String(file.path ?? "");
  const ext = extOf(path);

  if (!fileId || !path) continue;

  scanned += 1;

const existing = await getRepoFileStatus(repoId, fileId);

const hasStrongerVerifiedOk =
  existing &&
  (existing.source === "verify" || existing.source === "preverify") &&
  existing.status === "ok";

if (hasStrongerVerifiedOk) {
  console.log("[scan_vault] keeping stronger verified status", {
    repoId,
    fileId,
    path,
    existing,
  });

  okCount += 1;
  continue;
}
  
  try {
    if (!isTextScannableExt(ext)) {
      await setRepoFileStatus(
        repoId,
        fileId,
        "warn",
        "unsupported_file_type",
        "scan"
      );
      warnCount += 1;
      continue;
    }

    const readOut = await readRepoFileText(supabase, repoId, fileId);

if (!readOut.ok) {
  await setRepoFileStatus(
    repoId,
    fileId,
    "error",
    readOut.reason,
    "scan"
  );
  errorCount += 1;
  continue;
}

const content = readOut.content;

    let result:
      | { status: "ok" | "warn" | "error"; reason: string }
      | null = null;

    if (ext === ".py") {
      result = scanPythonText(content);
    } else if (ext === ".bas" || ext === ".vba") {
      result = scanMacroText(content);
    } else {
      result = scanGenericText(content);
    }

    await setRepoFileStatus(
      repoId,
      fileId,
      result.status,
      result.reason,
      "scan"
    );

    if (result.status === "ok") okCount += 1;
    else if (result.status === "warn") warnCount += 1;
    else errorCount += 1;
  } catch (e: any) {
    await setRepoFileStatus(
      repoId,
      fileId,
      "error",
      "scan_failed",
      "scan"
    );
    errorCount += 1;

    console.log("[scan_vault] file scan failed", {
      repoId,
      fileId,
      path,
      message: e?.message ?? String(e),
    });
  }
}

  return NextResponse.json({
    ok: true,
    repoId,
    scanned,
    okCount,
    warnCount,
    errorCount,
  });
}