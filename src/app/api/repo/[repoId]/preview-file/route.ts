import { supabaseServerComponent } from "@/lib/supabase/server";
import { vault_read_text } from "@/lib/vault/tools";

function inferContentType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function dirnameOf(path: string) {
  const s = String(path ?? "").trim();
  const idx = s.lastIndexOf("/");
  return idx === -1 ? "" : s.slice(0, idx);
}

function joinWithinDir(dir: string, leaf: string) {
  const cleanLeaf = String(leaf ?? "").trim().replace(/^\/+/, "");
  if (!dir) return cleanLeaf;
  return `${dir}/${cleanLeaf}`;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
  const { searchParams } = new URL(req.url);

  const requestedPath = String(searchParams.get("path") || "").trim();
  const basePath = String(searchParams.get("base") || "").trim();

  if (!requestedPath) {
    return new Response("Missing path", { status: 400 });
  }

  const supabase = await supabaseServerComponent();

  try {
    const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
      _repo_id: repoId,
    });

    if (memErr || !isMember) {
      return new Response("Forbidden", { status: 403 });
    }

    const normalizedPath = requestedPath
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");

    const baseDir = basePath ? dirnameOf(basePath) : "";

    const relativeCandidate =
      baseDir && normalizedPath
        ? joinWithinDir(baseDir, normalizedPath)
        : null;

    const candidatePaths: string[] = Array.from(
      new Set(
        [
          requestedPath,
          normalizedPath,
          relativeCandidate,
          `/${normalizedPath}`,
          !normalizedPath.startsWith("public/") ? `public/${normalizedPath}` : null,
          !normalizedPath.startsWith("src/") ? `src/${normalizedPath}` : null,
        ].filter((v): v is string => Boolean(v))
      )
    );

console.log("[preview_file_route] candidates", {
  repoId,
  requestedPath,
  basePath,
  baseDir,
  normalizedPath,
  candidatePaths,
});

type PreviewFileRow = {
  id: string;
  path: string;
  mime: string | null;
};

const { data: fileRows, error: fileErr } = await supabase
  .from("repo_files")
  .select("id, path, mime")
  .eq("repo_id", repoId)
  .in("path", candidatePaths)
  .is("deleted_at", null);

const rows = (fileRows ?? []) as PreviewFileRow[];

console.log("[preview_file_route] candidates", {
  repoId,
  requestedPath,
  normalizedPath,
  candidatePaths,
});

console.log("[preview_file_route] matched", {
  repoId,
  requestedPath,
  count: rows.length,
  paths: rows.map((r) => r.path),
  error: fileErr?.message ?? null,
});

if (fileErr || rows.length === 0) {
  return new Response(
    `Preview asset not found: ${requestedPath}\nCandidates: ${candidatePaths.join(", ")}`,
    { status: 404 }
  );
}

const preferredRow =
  rows.find((f) => relativeCandidate && f.path === relativeCandidate) ??
  rows.find((f) => f.path === requestedPath) ??
  rows.find((f) => f.path === normalizedPath) ??
  rows.find((f) => f.path === `/${normalizedPath}`) ??
  rows.find((f) => f.path === `public/${normalizedPath}`) ??
  rows.find((f) => f.path === `src/${normalizedPath}`) ??
  rows[0];

const resolvedPath = String(preferredRow.path ?? requestedPath);

const readResult = await vault_read_text(supabase, repoId, preferredRow.id);
let content = String(readResult?.content ?? "");

if (!content) {
  return new Response(`Preview asset empty: ${resolvedPath}`, { status: 404 });
}

const isHtmlFragment =
  resolvedPath.toLowerCase().endsWith(".html") &&
  !content.includes("<html") &&
  !content.includes("<body");

if (isHtmlFragment) {
  const cssHref =
    `/api/repo/${repoId}/preview-file?path=${encodeURIComponent("styles.css")}` +
    `&base=${encodeURIComponent(resolvedPath)}`;

  content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cssHref}" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #111;
    }
    body {
      padding: 24px;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

return new Response(content, {
  headers: {
    "Content-Type": isHtmlFragment
      ? "text/html; charset=utf-8"
      : inferContentType(resolvedPath),
    "Cache-Control": "no-store, no-cache, must-revalidate",
  },
});
  } catch (e: any) {
    console.error("[preview_file_route] failed", {
      repoId,
      requestedPath,
      message: e?.message,
      stack: e?.stack,
    });

    return new Response(
      `Preview asset route failed: ${e?.message ?? "unknown error"}`,
      { status: 500 }
    );
  }
}