import { supabaseServerComponent } from "@/lib/supabase/server";
import { vault_read_text } from "@/lib/vault/tools";

function inferContentType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function dirnameOf(path: string) {
  const s = String(path ?? "").trim();
  const idx = s.lastIndexOf("/");
  return idx === -1 ? "" : s.slice(0, idx);
}

function rewritePreviewHtml(html: string, repoId: string, currentPath: string, rev: string) {
  const assetBase = `/api/repo/${repoId}/preview-file`;
  const pageBase = `/repo/${repoId}/preview`;

  const normalize = (value: string) => String(value).trim();

  const assetUrl = (rawPath: string) => {
    return `${assetBase}?path=${encodeURIComponent(normalize(rawPath))}&base=${encodeURIComponent(currentPath)}&rev=${encodeURIComponent(rev)}`;
  };

  const pageUrl = (rawPath: string) => {
    return `${pageBase}?path=${encodeURIComponent(normalize(rawPath))}&rev=${encodeURIComponent(rev)}`;
  };

  return html
    .replace(
      /(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/gi,
      (_m, a, href, b) => {
        if (/^(https?:|data:|#|\/\/)/i.test(href)) return `${a}${href}${b}`;
        return `${a}${assetUrl(href)}${b}`;
      }
    )
    .replace(
      /(<script[^>]+src=["'])([^"']+)(["'][^>]*><\/script>)/gi,
      (_m, a, src, b) => {
        if (/^(https?:|data:|#|\/\/)/i.test(src)) return `${a}${src}${b}`;
        return `${a}${assetUrl(src)}${b}`;
      }
    )
    .replace(
      /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi,
      (_m, a, src, b) => {
        if (/^(https?:|data:|#|\/\/)/i.test(src)) return `${a}${src}${b}`;
        return `${a}${assetUrl(src)}${b}`;
      }
    )
    .replace(
      /(<a[^>]+href=["'])([^"']+\.html)(["'][^>]*>)/gi,
      (_m, a, href, b) => {
        if (/^(https?:|#|\/\/)/i.test(href)) return `${a}${href}${b}`;
        return `${a}${pageUrl(href)}${b}`;
      }
    );
}

export async function GET(
  req: Request,
  context: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await context.params;
  const { searchParams } = new URL(req.url);

const requestedPath = String(searchParams.get("path") || "index.html").trim();
const rev = String(searchParams.get("rev") || "0");

const supabase = await supabaseServerComponent();

try {
  const { data: isMember, error: memErr } = await supabase.rpc("is_repo_member", {
    _repo_id: repoId,
  });

  if (memErr || !isMember) {
    return new Response("Preview access denied.", { status: 403 });
  }

  const candidatePaths: string[] = Array.from(
  new Set(
    [
      requestedPath,
      requestedPath === "index.html" ? "src/index.html" : null,
    ].filter((v): v is string => Boolean(v))
  )
);

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

  if (fileErr || rows.length === 0) {
    return new Response(`Preview file not found: ${requestedPath}`, { status: 404 });
  }

  const preferredRow =
  rows.find((f) => f.path === requestedPath) ??
  rows.find((f) => f.path === "src/index.html") ??
  rows[0];

  const resolvedPath = String(preferredRow.path ?? requestedPath);

  const readResult = await vault_read_text(supabase, repoId, preferredRow.id);

  let content = String(readResult?.content ?? "");

  if (!content) {
    return new Response(`Preview file content empty: ${resolvedPath}`, { status: 404 });
  }

  if (resolvedPath.toLowerCase().endsWith(".html")) {
    content = content.replace(
      /<head([^>]*)>/i,
      `<head$1><meta name="vestaryn-preview-rev" content="${rev}">`
    );

    content = rewritePreviewHtml(content, repoId, resolvedPath, rev);
  }

  return new Response(content, {
    headers: {
      "Content-Type": inferContentType(resolvedPath),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
} catch (e: any) {
  console.error("[preview_route] failed", {
    repoId,
    requestedPath,
    message: e?.message,
    stack: e?.stack,
  });

  return new Response(`Preview route failed: ${e?.message ?? "unknown error"}`, {
    status: 500,
  });
}
}