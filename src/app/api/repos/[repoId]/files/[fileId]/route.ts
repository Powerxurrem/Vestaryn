import { NextResponse } from "next/server";
import { supabaseRouteHandler } from "@/lib/supabase/server";
import { resolveTierPolicyWithMeta } from "@/lib/membership/tiers";
import crypto from "crypto";
import { VAULT_BUCKET, SNAPSHOTS_BUCKET } from "@/lib/vault/buckets";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * @file app/api/repos/[repoId]/files/[fileId]/route.ts
 * @purpose File operations for Vault artifacts:
 *          - GET: return canonical metadata + signed URL (30m)
 *          - PUT: overwrite blob (v1 upsert) + update DB metadata
 *          - DELETE: soft-delete via deleted_at (audit-safe)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ repoId: string; fileId: string }> };

const FILE_SELECT =
  "id, repo_id, path, name, mime, size_bytes, storage_key, updated_at, created_at, deleted_at";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

function isTextLikeMime(mime: string | null | undefined, path: string | null | undefined) {
  const m = String(mime ?? "").toLowerCase();
  const p = String(path ?? "").toLowerCase();

  if (
    m.startsWith("text/") ||
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("typescript") ||
    m.includes("xml") ||
    m.includes("svg")
  ) {
    return true;
  }

  return /\.(ts|tsx|js|jsx|css|html|md|txt|json|py|sql|bas|xml|svg|yml|yaml)$/i.test(p);
}

function json(
  body: any,
  status = 200,
  extraHeaders?: Record<string, string>
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(extraHeaders ?? {}) },
  });
}

// ─────────────────────────────────────────────────────────────
// PUT /api/repos/[repoId]/files/[fileId]
// Overwrite blob (v1 upsert) + update DB metadata + return canonical DB row
// ─────────────────────────────────────────────────────────────
export async function PUT(req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  if (!isUuid(repoId) || !isUuid(fileId)) {
    return json(
      { error: "invalid ids", received: { repoId, fileId } },
      400
    );
  }

  const supabase = await supabaseRouteHandler();

  // Auth (keeps behavior consistent; RLS still enforces access)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

const supabaseAdmin = createSupabaseAdmin();

// ─────────────────────────────────────────────────────────────
// Tier clamp: exporting/downloading requires allowExport
// Server is canonical; client headers are advisory and clamped.
// ─────────────────────────────────────────────────────────────
const requestedTier = req.headers.get("x-vestaryn-tier");

const isAdminAllowed =
  process.env.NODE_ENV !== "production" ||
  process.env.VESTARYN_ALLOW_ADMIN_TIER === "1";

const { policy: tierPolicy, meta: tierMeta } = resolveTierPolicyWithMeta(requestedTier, {
  isAdminAllowed,
  forcedTier: "early_access",
});
// ✅ This line ensures tierMeta is "read" so TS is happy
console.log("[tier]", tierMeta);

console.log("[tier]", {
  requested: tierMeta.requested,
  effective: tierMeta.effective,
  adminClamped: tierMeta.adminClamped,
  forced: tierMeta.forced,
  model: tierPolicy.model,
  maxOutputTokens: tierPolicy.output.maxOutputTokens,
  maxToolRounds: tierPolicy.tools.maxToolRounds,
});

const url = new URL(req.url);
const mode = (url.searchParams.get("mode") ?? "open").toLowerCase();

if (mode === "export" && !tierPolicy.capabilities.allowExport) {
  return new NextResponse("Export is not available on your tier. Upgrade to Pro.", { status: 403 });
}

  // Parse payload
  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? "");
  const mime = String(body?.mime ?? "text/plain");
const contentHash = crypto.createHash("sha256").update(content).digest("hex");

console.log("[file_put] incoming", {
  repoId,
  fileId,
  mime,
  bytes: Buffer.byteLength(content, "utf8"),
  sha256: contentHash,
  hasBrokenMarker: content.includes("{count};"),
  hasCleanMarker: content.includes("{count}</div>"),
});

const interestingLines = content
  .split(/\r?\n/)
  .map((line, i) => ({ n: i + 1, line }))
  .filter(
    ({ line }) =>
      line.includes("return ") ||
      line.includes("{count}") ||
      line.includes("LeakGuardTest")
  );

console.log("[file_put] interesting_lines", interestingLines);
  const bytes = new TextEncoder().encode(content);
  const buf = Buffer.from(bytes);

  // Load file row to get storage_key (and ensure membership via RLS)
  const { data: fileRow, error: fileErr } = await supabase
    .from("repo_files")
    .select("id, repo_id, storage_key, deleted_at")
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .single();

  if (fileErr) return json({ error: fileErr.message }, 400);
  if (fileRow?.deleted_at) return json({ error: "not found" }, 404);

  const storageKey: string | null = fileRow.storage_key;
  if (!storageKey) return json({ error: "missing storage_key" }, 400);

  // Write blob (v1: overwrite same key)
  const { error: upErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(storageKey, buf, { contentType: mime, upsert: true });

  if (upErr) return json({ error: upErr.message }, 400);

const dl = await supabase.storage.from(VAULT_BUCKET).download(storageKey);
if (dl.data) {
  const savedText = await dl.data.text();
  console.log("[file_put] readback", {
    storageKey,
    bytes: Buffer.byteLength(savedText, "utf8"),
    hasBrokenMarker: savedText.includes("{count};"),
    hasCleanMarker: savedText.includes("{count}</div>"),
  });
}

  // Update DB metadata (DB remains canon)
  const { error: updErr } = await supabase
    .from("repo_files")
    .update({
      size_bytes: buf.byteLength,
      mime,
      // updated_at ideally handled by DB trigger/default
    })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (updErr) return json({ error: updErr.message }, 400);

   const { error: statusErr } = await supabaseAdmin
    .from("repo_file_status")
    .upsert(
      {
        repo_id: repoId,
        file_id: fileId,
        status: "pending",
        reason: "modified_since_verify",
        source: "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repo_id,file_id" }
    );

  if (statusErr) {
    console.log("[file_put] status invalidate failed", {
      repoId,
      fileId,
      message: statusErr.message,
    });
  }

  // Read back canonical metadata and return it (locks UI to DB truth)
  const { data: updated, error: readErr } = await supabase
    .from("repo_files")
    .select(FILE_SELECT)
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .single();

  if (readErr) return json({ error: readErr.message }, 400);

  return json({ file: updated }, 200);
}

// ─────────────────────────────────────────────────────────────
// GET /api/repos/[repoId]/files/[fileId]
// Return metadata + signed_url (30m). Uses latest version storage_key if present.
// ─────────────────────────────────────────────────────────────
export async function GET(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  if (!isUuid(repoId) || !isUuid(fileId)) {
    return json(
      { error: "invalid ids", received: { repoId, fileId } },
      400
    );
  }

  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains the real access boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // Read file row (DB canon)
  const { data: file, error: fileErr } = await supabase
    .from("repo_files")
    .select(FILE_SELECT)
    .eq("id", fileId)
    .eq("repo_id", repoId)
    .maybeSingle();

  if (fileErr) return json({ error: fileErr.message }, 400);
  if (!file || file.deleted_at) return json({ error: "not found" }, 404);

  const storageKey: string | null = file.storage_key as any;

  if (!storageKey) return json({ error: "missing storage_key" }, 400);

    // Sign URL (30 min)
  const { data: signed, error: signErr } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(storageKey, 60 * 30);

  if (signErr) return json({ error: signErr.message }, 400);
  if (!signed?.signedUrl) return json({ error: "failed to sign url" }, 400);

  let content: string | null = null;

  if (isTextLikeMime(file.mime, file.path)) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(VAULT_BUCKET)
      .download(storageKey);

    if (dlErr) {
      return json({ error: dlErr.message }, 400);
    }

    content = await blob.text();
  }

  return json({
    file,
    latest_version: null,
    signed_url: signed.signedUrl,
    content,
  });
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/repos/[repoId]/files/[fileId]
// Soft delete (audit-safe). Storage objects are not removed here.
// ─────────────────────────────────────────────────────────────
export async function DELETE(_req: Request, ctx: Ctx) {
  const { repoId, fileId } = await ctx.params;

  if (!isUuid(repoId) || !isUuid(fileId)) {
    return json(
      { error: "invalid ids", received: { repoId, fileId } },
      400
    );
  }

  const supabase = await supabaseRouteHandler();

  // Auth (RLS remains the real access boundary)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // Soft delete (application-level visibility rule; keep RLS clean)
  const { error } = await supabase
    .from("repo_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fileId)
    .eq("repo_id", repoId);

  if (error) return json({ error: error.message }, 400);

  return json({ ok: true }, 200);
}