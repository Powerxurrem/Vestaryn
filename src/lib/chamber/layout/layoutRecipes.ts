export type LayoutRecipeId =
  | "grid_three_per_row"
  | "equal_card_heights";

export type LayoutRecipe = {
  id: LayoutRecipeId;
  phrases: RegExp[];
  preferredTarget: "styles.css" | "index.html";
  applyTo: "css";
  priority?: number;
};

export const LAYOUT_RECIPES: LayoutRecipe[] = [
  {
    id: "grid_three_per_row",
    phrases: [
      /\bmax 3 blocks per row\b/i,
      /\bmax three blocks per row\b/i,
      /\b3 blocks per row\b/i,
      /\bthree blocks per row\b/i,
      /\b3 per row\b/i,
      /\bthree per row\b/i,
      /\b2 rows of blocks\b/i,
      /\btwo rows of blocks\b/i,
    ],
    preferredTarget: "styles.css",
    applyTo: "css",
    priority: 100,
  },
  {
    id: "equal_card_heights",
    phrases: [
      /\bsame height\b/i,
      /\bequal height\b/i,
      /\bmatch height\b/i,
      /\bheight doesn'?t match\b/i,
      /\bheight does not match\b/i,
      /\bthe height still doesn'?t match\b/i,
      /\blower .* same height\b/i,
    ],
    preferredTarget: "styles.css",
    applyTo: "css",
    priority: 95,
  },
];

export function detectLayoutRecipe(text: string): LayoutRecipe | null {
  const input = String(text ?? "").trim();
  if (!input) return null;

  const ranked = LAYOUT_RECIPES
    .filter((recipe) => recipe.phrases.some((re) => re.test(input)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return ranked[0] ?? null;
}