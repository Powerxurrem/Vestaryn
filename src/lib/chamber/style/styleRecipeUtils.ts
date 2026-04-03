import type { StyleRecipe } from "./styleRecipes";

export function cssRuleExists(currentCss: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\.${escaped}\\b`);
  return re.test(currentCss);
}

export function appendCssRuleIfMissing(currentCss: string, recipe: StyleRecipe): string {
  if (cssRuleExists(currentCss, recipe.className)) {
    return currentCss;
  }

  const trimmed = currentCss.trimEnd();
  return `${trimmed}\n\n${recipe.css}\n`;
}

export function ensureClassOnHtmlTag(html: string, className: string): string {
  if (!html || !className) return html;
  if (html.includes(className)) return html;

  // conservative: first content-card target only
  return html.replace(
    /class="([^"]*\bcontent-card\b[^"]*)"/i,
    (_m, classes) => `class="${`${classes} ${className}`.trim()}"`
  );
}