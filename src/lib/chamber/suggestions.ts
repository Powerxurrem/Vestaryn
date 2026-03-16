export function choosePrimarySuggestionTarget(
  appliedFiles: Array<{ path?: string | null; mime?: string | null }>
) {
  const files = appliedFiles
    .map((f) => ({
      path: String(f.path ?? "").trim(),
      mime: String(f.mime ?? "").trim(),
    }))
    .filter((f) => f.path);

  if (files.length === 0) return null;

  const preferred = files.find((f) =>
    /\.(html|tsx|ts|jsx|js|css|md)$/i.test(f.path) &&
    !f.path.startsWith("memory/")
  );
  if (preferred) return preferred;

  const nonMemory = files.find((f) => !f.path.startsWith("memory/"));
  if (nonMemory) return nonMemory;

  return files[0];
}

export function buildSuggestedPromptsFromAppliedFiles(
  appliedFiles: Array<{ path?: string | null; mime?: string | null }>
) {
  const target = choosePrimarySuggestionTarget(appliedFiles);
  const path = String(target?.path ?? "").trim();
  const lower = path.toLowerCase();

  if (!path) {
    return [
      "Suggest the next beginner-friendly step for this project",
      "Explain what was just changed",
      "Add one small next improvement to this project",
    ];
  }

  if (lower.endsWith(".html")) {
    return [
      `Update ${path} to make the page mobile responsive`,
      `Update ${path} to add a footer with a short about section`,
      `Explain how the HTML and CSS in ${path} work`,
    ];
  }

  if (lower.endsWith(".css")) {
    return [
      `Update ${path} to improve spacing and overall polish`,
      `Update ${path} to add hover effects and smoother styling`,
      `Explain what each section of ${path} does`,
    ];
  }

  if (lower.endsWith(".tsx") || lower.endsWith(".ts") || lower.endsWith(".jsx") || lower.endsWith(".js")) {
    return [
      `Update ${path} to add one small next feature`,
      `Refactor ${path} to be easier for a beginner to understand`,
      `Explain what ${path} does step by step`,
    ];
  }

  if (lower.endsWith("readme.md")) {
    return [
      `Create the next project files described in ${path}`,
      `Update ${path} to make the setup steps easier for a beginner`,
      `Explain the setup steps in ${path} more simply`,
    ];
  }

  return [
    `Update ${path} with one small next improvement`,
    `Explain what was changed in ${path}`,
    `Suggest the next beginner-friendly change for ${path}`,
  ];
}