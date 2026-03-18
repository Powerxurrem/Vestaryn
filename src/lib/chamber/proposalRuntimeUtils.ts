import {
  normalizeForNoopCheck,
  sha256,
  confirmPhrase,
  confirmCreatePhrase,
} from "@/lib/vault/utils";
import { looksLikeStandaloneModule } from "@/lib/chamber/intent";

export function dedupePendingProposals(
  proposals: Array<{
    fileId?: string;
    path?: string | null;
    meta?: any;
    [key: string]: any;
  }>
) {
  const byKey = new Map<string, any>();

  for (const proposal of proposals) {
    const op = String(proposal?.meta?.op ?? "").trim().toLowerCase();
    const fileId = String(proposal?.fileId ?? "").trim();
    const path = String(proposal?.path ?? proposal?.meta?.path ?? "").trim();

    const key =
      op === "create"
        ? path
          ? `create:${path}`
          : ""
        : fileId
          ? `file:${fileId}`
          : path
            ? `path:${path}`
            : "";

    if (!key) continue;

    console.log("[proposal_dedupe key]", {
      op,
      fileId,
      path,
      key,
    });

    // last proposal wins
    byKey.set(key, proposal);
  }

  return Array.from(byKey.values());
}

export function isProbablyBrokenSplitFile(path: string, content: string) {
  const text = String(content ?? "").trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { broken: true, reason: "empty_file" as const };
  }

  if (text.length < 40) {
    return { broken: true, reason: "too_small" as const };
  }

  const hasDefaultExport =
    /\bexport\s+default\s+([A-Za-z0-9_]+)\s*;?/.test(text);
  const defaultExportMatch = text.match(
    /\bexport\s+default\s+([A-Za-z0-9_]+)\s*;?/
  );
  const defaultExportName = defaultExportMatch?.[1] ?? null;

  if (hasDefaultExport && defaultExportName) {
    const definesLocally =
      new RegExp(`\\bconst\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(`\\bfunction\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(`\\bclass\\s+${defaultExportName}\\b`).test(text);

    const importsName =
      new RegExp(`\\bimport\\s+${defaultExportName}\\b`).test(text) ||
      new RegExp(
        `\\bimport\\s*\\{[^}]*\\b${defaultExportName}\\b[^}]*\\}`
      ).test(text);

    if (!definesLocally && !importsName) {
      return { broken: true, reason: "dangling_default_export" as const };
    }
  }

  const placeholderPatterns = [
    "rest of file unchanged",
    "other code remains unchanged",
    "the rest of the file",
    "omitted",
    "...",
  ];

  if (placeholderPatterns.some((p) => lower.includes(p))) {
    return { broken: true, reason: "placeholder_text" as const };
  }

  return { broken: false as const, reason: null };
}

export function validateGeneratedSplitFiles(args: {
  sourcePath: string;
  sourceContent: string;
  targetPaths: string[];
  files: Array<{ path: string; content: string }>;
}) {
  const { sourcePath, sourceContent, targetPaths, files } = args;

  if (!Array.isArray(files) || files.length !== targetPaths.length) {
    return {
      ok: false,
      reason: "target_count_mismatch",
      details: {
        expected: targetPaths.length,
        actual: Array.isArray(files) ? files.length : 0,
      },
    };
  }

  const returnedPaths = files.map((f) => String(f.path ?? "").trim());
  const expectedPaths = targetPaths.map((p) => String(p).trim());

  for (let i = 0; i < expectedPaths.length; i++) {
    if (returnedPaths[i] !== expectedPaths[i]) {
      return {
        ok: false,
        reason: "target_path_mismatch",
        details: {
          expectedPaths,
          returnedPaths,
        },
      };
    }
  }

  const badFiles: Array<{ path: string; reason: string }> = [];

  for (const file of files) {
    const content = String(file.content ?? "");

    if (!content.trim()) {
      badFiles.push({
        path: file.path,
        reason: "empty_content",
      });
      continue;
    }

    const check = isProbablyBrokenSplitFile(file.path, content);
    if (check.broken) {
      badFiles.push({ path: file.path, reason: String(check.reason) });
      continue;
    }

    if (!looksLikeStandaloneModule(file.path, content)) {
      badFiles.push({
        path: file.path,
        reason: "not_standalone_module",
      });
      continue;
    }
  }

  if (badFiles.length > 0) {
    return {
      ok: false,
      reason: "invalid_split_shape",
      details: { badFiles },
    };
  }

  const sourceLen = String(sourceContent ?? "").trim().length;
  const fileLens = files.map((f) => String(f.content ?? "").trim().length);
  const tinyCount = fileLens.filter(
    (n) => n < Math.max(60, Math.floor(sourceLen * 0.08))
  ).length;

  if (files.length >= 2 && tinyCount >= Math.max(1, files.length - 1)) {
    return {
      ok: false,
      reason: "over_fragmented_split",
      details: { fileLens, sourceLen },
    };
  }

  return {
    ok: true as const,
    reason: null,
    details: null,
  };
}

export function assertCanonicalProposal(proposal: any) {
  const content = String(proposal?.content ?? "");
  const fileId = String(proposal?.fileId ?? "");
  const nextHash = String(proposal?.nextHash ?? "");
  const op = String(proposal?.meta?.op ?? "");
  const confirm = String(proposal?.confirm ?? "");

  const recomputedHash = sha256(normalizeForNoopCheck(content));
  const expectedConfirm =
    op === "create"
      ? confirmCreatePhrase(fileId, recomputedHash)
      : confirmPhrase(fileId, recomputedHash);

  console.log("[proposal_canonical_check]", {
    fileId,
    path: proposal?.path ?? null,
    op,
    nextHash,
    recomputedHash,
    confirm,
    expectedConfirm,
    contentHead: content.slice(0, 80),
  });

  if (nextHash !== recomputedHash) {
    throw new Error(
      `Non-canonical proposal hash for ${proposal?.path ?? fileId}: expected ${recomputedHash}, got ${nextHash}`
    );
  }

  if (confirm !== expectedConfirm) {
    throw new Error(
      `Non-canonical proposal confirm for ${proposal?.path ?? fileId}`
    );
  }
}