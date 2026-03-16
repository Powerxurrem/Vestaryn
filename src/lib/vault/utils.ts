import { createHash } from "crypto";


export function normalizeForNoopCheck(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function confirmPhrase(fileId: string, nextHash: string) {
  return `APPLY ${fileId} ${nextHash}`;
}

export function confirmCreatePhrase(fileId: string, nextHash: string) {
  return `CREATE ${fileId} ${nextHash}`;
}

export function normalizePath(p: string) {
  const s = (p || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  // prevent accidental leading slashes
  return s.replace(/^\/+/, "");
}

export function nameFromPath(path: string) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts[parts.length - 1] || path || "new-file.txt";
}

export function inferTextMimeFromPath(path: string) {
  const p = String(path || "").toLowerCase();

  if (p.endsWith(".tsx")) return "text/tsx";
  if (p.endsWith(".ts")) return "application/typescript";
  if (p.endsWith(".jsx")) return "text/jsx";
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) {
    return "application/javascript";
  }
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".md")) return "text/markdown";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html")) return "text/html";

  return "text/plain";
}

export function stripCodeFences(text: string) {
  const s = String(text ?? "").trim();
  const fenced = s.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fenced?.[1]) return fenced[1].trim();
  return s;
}

export function stripDuplicateTriplet(text: string) {
  const first = text.indexOf("[Observation]");
  if (first === -1) return text.trim();

  const second = text.indexOf("[Observation]", first + 12);
  if (second !== -1) return text.slice(0, second).trim();

  return text.trim();
}

export function scrubVisibleToolPayload(text: string) {
  let out = (text || "");

  // 1) Remove full JSON-ish blobs containing proposal/tool keys
  out = out.replace(
    /\{[\s\S]*?(prevHash|nextHash|fileId|storage_key|confirm|mime|bytes|content|preview_lines|op|path|status)[\s\S]*?\}/g,
    ""
  );

  // 2) If structured payload leaks after the allowed visible sentence, hard-truncate it
  out = out.replace(
    /(A staged change is ready\. Confirm to apply\.)[\s\S]*$/m,
    "$1"
  );

  // 3) Remove common broken tail fragments if they appear on their own
  out = out.replace(
    /(^|\n)\s*["',{][\s\S]*?(preview_lines|fileId|path|op|status)[\s\S]*$/m,
    ""
  );

  return out.trim();
}

export function ensureTriplet(text: string) {
  const t = (text || "").trim();
  if (!t) return "";
  if (t.startsWith("[Observation]")) return t;

  return `[Observation]\nAssistant produced a non-contract response.\n\n[Assessment]\nThe raw output did not start with the required marker, so it would be hidden by contract-based rendering.\n\n[Action]\n${t}`.trim();
}