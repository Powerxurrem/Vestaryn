export type RepoProjectType =
  | "node_typescript"
  | "nextjs"
  | "python"
  | "loose_files"
  | "unknown";

export type RepoInferenceConfidence = "high" | "medium" | "low";

export type RepoInference = {
  projectType: RepoProjectType;
  confidence: RepoInferenceConfidence;
  needsBootstrap: boolean;
  reasons: string[];
};

export function inferRepoProfile(paths: string[]): RepoInference {
  const normalized = paths
    .map((p) => String(p || "").trim().replace(/\\/g, "/").toLowerCase())
    .filter(Boolean);

  const set = new Set(normalized);

  const has = (name: string) => set.has(name.toLowerCase());

  const hasPrefix = (prefix: string) =>
    normalized.some((p) => p.startsWith(prefix.toLowerCase()));

  const hasExt = (...exts: string[]) =>
    normalized.some((p) => exts.some((ext) => p.endsWith(ext)));

  const nonMemoryPaths = normalized.filter((p) => !p.startsWith("memory/"));

  const zipOnly =
    nonMemoryPaths.length > 0 &&
    nonMemoryPaths.every((p) => p.endsWith(".zip"));

  // Next.js
  if (
    has("package.json") &&
    (has("next.config.js") ||
      has("next.config.mjs") ||
      has("next.config.ts") ||
      hasPrefix("app/") ||
      hasPrefix("pages/"))
  ) {
    return {
      projectType: "nextjs",
      confidence: "high",
      needsBootstrap: false,
      reasons: [],
    };
  }

  // Node TypeScript
  if (has("package.json") && (has("tsconfig.json") || hasExt(".ts", ".tsx"))) {
    return {
      projectType: "node_typescript",
      confidence: "high",
      needsBootstrap: false,
      reasons: [],
    };
  }

  // Python
  if (has("pyproject.toml") || has("requirements.txt") || hasExt(".py")) {
    return {
      projectType: "python",
      confidence: "medium",
      needsBootstrap: false,
      reasons: [],
    };
  }

  // Archive-only repo
  if (zipOnly) {
    return {
      projectType: "unknown",
      confidence: "low",
      needsBootstrap: true,
      reasons: ["archive_only_repo"],
    };
  }

  // Loose JS/TS files but no manifest
  if (hasExt(".ts", ".tsx", ".js", ".jsx")) {
    return {
      projectType: "loose_files",
      confidence: "medium",
      needsBootstrap: true,
      reasons: ["no_project_manifest"],
    };
  }

  return {
    projectType: "unknown",
    confidence: "low",
    needsBootstrap: true,
    reasons: ["unrecognized_repo_shape"],
  };
}