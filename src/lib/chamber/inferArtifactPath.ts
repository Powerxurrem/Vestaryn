export function inferArtifactPath(content: string): string | null {
  const s = String(content ?? "").toLowerCase();

  const asksToCreateCode =
    /\b(write|create|generate|build|make|convert)\b/.test(s);

  const isPlanning =
    /\b(design|structure|schema|dashboard|plan|planning|analysis|scaffold|spec|specification)\b/.test(s);

  if (isPlanning && !asksToCreateCode) {
    return null;
  }

  // Excel / VBA
  const mentionsVBA = /\b(vba|macro|\.bas|excel macro|module)\b/.test(s);
  if (mentionsVBA && asksToCreateCode) {
    return "macro.bas";
  }

  // Python
  const mentionsPython =
    /\b(python|\.py|openpyxl|pandas)\b/.test(s) ||
    /\bscript\b/.test(s);

  if (mentionsPython && asksToCreateCode) {
    return "script.py";
  }

  // Node / JS
  if (/\b(node|javascript|js script)\b/.test(s) && asksToCreateCode) {
    return "index.js";
  }

  // HTML
  if (/\b(html|webpage|website)\b/.test(s)) {
    return "index.html";
  }

  return null;
}