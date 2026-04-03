import { detectStyleRecipe } from "@/lib/chamber/style/styleRecipes";
import { appendCssRuleIfMissing } from "@/lib/chamber/style/styleRecipeUtils";

export type StyleFastPathResult =
  | {
      ok: true;
      kind: "css_style_recipe";
      recipeId: string;
      nextContent: string;
      className: string;
    }
  | {
      ok: false;
      reason: string;
    };

export function applyStyleRecipeFastPath(args: {
  userText: string;
  currentPath: string;
  currentContent: string;
}): StyleFastPathResult {
  const { userText, currentPath, currentContent } = args;

  if (!/\.css$/i.test(String(currentPath ?? ""))) {
    return { ok: false, reason: "not_css_target" };
  }

  const recipe = detectStyleRecipe(userText);
  if (!recipe) {
    return { ok: false, reason: "no_matching_recipe" };
  }

  const nextContent = appendCssRuleIfMissing(currentContent, recipe);

  if (nextContent === currentContent) {
    return { ok: false, reason: "already_satisfied" };
  }

  return {
    ok: true,
    kind: "css_style_recipe",
    recipeId: recipe.id,
    nextContent,
    className: recipe.className,
  };
}