import { detectLayoutRecipe } from "@/lib/chamber/layout/layoutRecipes";

export type LayoutFastPathResult =
  | {
      ok: true;
      kind: "css_layout_recipe";
      recipeId: string;
      nextContent: string;
    }
  | {
      ok: false;
      reason: string;
    };

function ensureRule(currentCss: string, marker: string, rule: string): string {
  if (currentCss.includes(marker)) return currentCss;
  return `${currentCss.trimEnd()}\n\n${rule.trim()}\n`;
}

function applyGridThreePerRow(currentCss: string): string {
  let next = currentCss;

  if (/\.section-grid\s*\{[\s\S]*?grid-template-columns:/m.test(next)) {
    next = next.replace(
      /(\.section-grid\s*\{[\s\S]*?)grid-template-columns\s*:[^;]+;/m,
      `$1grid-template-columns: repeat(3, minmax(0, 1fr));`
    );
  } else {
    next = ensureRule(
      next,
      ".section-grid {",
      `
.section-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
`
    );
  }

  next = ensureRule(
    next,
    "@media (max-width: 900px)",
    `
@media (max-width: 900px) {
  .section-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .section-grid {
    grid-template-columns: 1fr;
  }
}
`
  );

  return next;
}

function applyEqualCardHeights(currentCss: string): string {
  let next = currentCss;

  next = ensureRule(
    next,
    ".section-grid > .card",
    `
.section-grid > .card {
  height: 100%;
}

.section-grid {
  align-items: stretch;
}
`
  );

  return next;
}

export function applyLayoutRecipeFastPath(args: {
  userText: string;
  currentPath: string;
  currentContent: string;
}): LayoutFastPathResult {
  const { userText, currentPath, currentContent } = args;

  if (!/\.css$/i.test(String(currentPath ?? ""))) {
    return { ok: false, reason: "not_css_target" };
  }

  const recipe = detectLayoutRecipe(userText);
  if (!recipe) {
    return { ok: false, reason: "no_matching_recipe" };
  }

  let nextContent = currentContent;

  if (recipe.id === "grid_three_per_row") {
    nextContent = applyGridThreePerRow(currentContent);
  } else if (recipe.id === "equal_card_heights") {
    nextContent = applyEqualCardHeights(currentContent);
  }

  if (nextContent === currentContent) {
    return { ok: false, reason: "already_satisfied" };
  }

  return {
    ok: true,
    kind: "css_layout_recipe",
    recipeId: recipe.id,
    nextContent,
  };
}