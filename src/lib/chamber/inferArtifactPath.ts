export function inferArtifactPath(content: string): string | null {
  const s = content.toLowerCase();

  // Excel / VBA
  if (/\b(excel|vba|macro)\b/.test(s)) {
    return "macro.bas";
  }

  // Python
  if (/\bpython\b/.test(s)) {
    return "script.py";
  }

  // Node / JS
  if (/\b(node|javascript|js script)\b/.test(s)) {
    return "index.js";
  }

  // HTML
  if (/\b(html|webpage|website)\b/.test(s)) {
    return "index.html";
  }

  return null;
}