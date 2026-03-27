export function extractRepoPathMentions(args: {
  content: string;
  repoPaths: string[];
}): string[] {
  const text = String(args.content ?? "");
  const repoPaths = Array.isArray(args.repoPaths) ? args.repoPaths : [];

  const found: string[] = [];

  for (const path of repoPaths) {
    const p = String(path ?? "").trim();
    if (!p) continue;

    if (text.includes(p)) {
      found.push(p);
    }
  }

  found.sort((a, b) => b.length - a.length);

  return Array.from(new Set(found));
}