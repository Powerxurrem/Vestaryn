import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseRouteHandler } from "@/lib/supabase/server";

/**
 * @file app/api/repos/[repoId]/files/create/route.ts
 * @purpose Create a new Vault file (DB row + initial v1 storage object).
 * @exports POST
 *
 * Invariants:
 * - Storage key format: repos/<repoId>/<fileId>/v1
 * - DB (repo_files) is metadata source-of-truth
 * - Soft-delete not touched here
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ repoId: string }> };

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

function inferMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".js") || n.endsWith(".mjs") || n.endsWith(".cjs"))
    return "application/javascript";
  if (n.endsWith(".ts") || n.endsWith(".tsx")) return "application/typescript";
  if (n.endsWith(".jsx")) return "text/jsx";
  if (n.endsWith(".html")) return "text/html";
  if (n.endsWith(".css")) return "text/css";
  return "text/plain";
}

function json(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// ─────────────────────────────────────────────────────────────
// POST /api/repos/[repoId]/files/create
// Creates repo_files row + uploads initial content to storage (v1)
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request, ctx: Ctx) {
  const { repoId } = await ctx.params;

  if (!repoId || repoId === "undefined" || !isUuid(repoId)) {
    return json({ error: "invalid repoId", received: repoId }, 400);
  }

  const supabase = await supabaseRouteHandler();

  // Auth (RLS still enforces access, this just makes failures clearer)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // Parse payload
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const content = String(body?.content ?? "");

  // Validate file name (prevent path traversal / nested paths)
  if (!name) return json({ error: "File name required" }, 400);

  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return json({ error: "Invalid file name" }, 400);
  }

  // IDs + encoding
  const fileId = randomUUID();
  const bytes = new TextEncoder().encode(content);
  const buf = Buffer.from(bytes);

  // Mime inference
  const mime = inferMime(name);

  // Storage key invariant (v1 model)
  const storageKey = `repos/${repoId}/${fileId}/v1`;

  // 1) Insert DB row first (metadata canon)
  const { data: fileRow, error: insertErr } = await supabase
    .from("repo_files")
    .insert({
      id: fileId,
      repo_id: repoId,
      path: name,
      name,
      mime,
      size_bytes: buf.byteLength,
      storage_key: storageKey,
    })
    .select(
      "id, repo_id, path, name, mime, size_bytes, storage_key, updated_at, created_at, deleted_at"
    )
    .single();

  if (insertErr) {
    return json({ error: insertErr.message }, 400);
  }

  // 2) Upload storage object (initial v1)
  const { error: upErr } = await supabase.storage
    .from("vestaryn-files")
    .upload(storageKey, buf, {
      contentType: mime,
      upsert: false,
    });

  // Rollback on upload failure (hard delete DB row)
  if (upErr) {
    await supabase
      .from("repo_files")
      .delete()
      .eq("id", fileId)
      .eq("repo_id", repoId);
    return json({ error: upErr.message }, 400);
  }

  return json({ file: fileRow }, 200);
}