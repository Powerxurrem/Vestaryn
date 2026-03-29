export function normalizeCommonPathVariants(path: string): string {
  const p = String(path ?? "").trim().toLowerCase();

  if (!p) return "";

  // normalize slashes
  let normalized = p.replace(/\\/g, "/");

  // remove leading ./
  normalized = normalized.replace(/^\.\//, "");

  // basic aliasing
  if (normalized === "index" || normalized === "home") {
    return "index.html";
  }

  if (normalized === "about" || normalized === "about page") {
    return "about.html";
  }

  // ensure extension for html-like names
  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    if (normalized.includes("about")) return "about.html";
    if (normalized.includes("index")) return "index.html";
  }

  return normalized;
}