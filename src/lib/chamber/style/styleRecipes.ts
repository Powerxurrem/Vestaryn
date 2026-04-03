export type StyleRecipeId =
  // Wave 1
  | "glow_soft"
  | "glow_neon"
  | "glass_frosted"
  | "corners_sharp"
  | "corners_angled"
  | "spacing_loose"
  | "spacing_compact"
  | "size_tall"

  // Wave 2
  | "aura_ambient"
  | "depth_elevated"
  | "border_emphasis"
  | "border_neon"
  | "style_modern"
  | "style_futuristic"
  | "obsidian_surface"

  // Wave 3
  | "style_premium"
  | "depth_embedded"
  | "corners_rounded"
  | "shape_square"

  // Wave 4 — color / palette
  | "palette_neon_blue"
  | "palette_cyber_purple"
  | "palette_obsidian"
  | "palette_warm_gold"
  | "palette_high_contrast"
  | "palette_dutch_flag"
  | "background_tulip_fields"
  | "background_windmills"
  | "navbar_dutch_flag";

export type StylePatchMode =
  | "css_rule_append"
  | "ensure_class_and_css_rule";

export type StyleRecipe = {
  id: StyleRecipeId;
  phrases: RegExp[];
  preferredTarget: "styles.css";
  patchMode: StylePatchMode;
  className: string;
  css: string;
  priority?: number;
};

export const STYLE_RECIPES: StyleRecipe[] = [
  // ─────────────────────────────────────────
  // Wave 1
  // ─────────────────────────────────────────
  {
    id: "glow_soft",
    phrases: [
      /\bsoft glow\b/i,
      /\bsubtle glow\b/i,
      /\bgentle glow\b/i,
      /\bglow softly\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--glow-soft",
    css: `
.content-card--glow-soft {
  box-shadow:
    0 0 12px rgba(80,160,255,0.18),
    0 0 28px rgba(80,160,255,0.10);
}
`.trim(),
    priority: 80,
  },
  {
    id: "glow_neon",
    phrases: [
      /\bneon glow\b/i,
      /\bneon edge glow\b/i,
      /\belectric glow\b/i,
      /\bglowing border\b/i,
      /\bneon edge\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--neon-glow",
    css: `
.content-card--neon-glow {
  box-shadow:
    0 0 12px rgba(0,212,255,0.28),
    0 0 24px rgba(124,92,255,0.18),
    0 0 40px rgba(0,212,255,0.12);
}
`.trim(),
    priority: 100,
  },
  {
    id: "glass_frosted",
    phrases: [
      /\bfrosted\b/i,
      /\bfrosted blur\b/i,
      /\bglass\b/i,
      /\bglassy\b/i,
      /\btranslucent\b/i,
      /\bblurred panel\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--frosted",
    css: `
.content-card--frosted {
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(12px) saturate(1.08);
  -webkit-backdrop-filter: blur(12px) saturate(1.08);
  border: 1px solid rgba(255,255,255,0.10);
}
`.trim(),
    priority: 100,
  },
  {
    id: "corners_sharp",
    phrases: [
      /\bsharp\b/i,
      /\bsharp edges\b/i,
      /\bsharp corners\b/i,
      /\bangular\b/i,
      /\baggressive\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--sharp",
    css: `
.content-card--sharp {
  border-radius: 0;
}
`.trim(),
    priority: 90,
  },
  {
    id: "corners_angled",
    phrases: [
      /\bangled cuts\b/i,
      /\bcut corners\b/i,
      /\bfuturistic cuts\b/i,
      /\bchamfered corners\b/i,
      /\bangled corners\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--angled",
    css: `
.content-card--angled {
  clip-path: polygon(
    0% 10%, 10% 0%,
    90% 0%, 100% 10%,
    100% 90%, 90% 100%,
    10% 100%, 0% 90%
  );
}
`.trim(),
    priority: 95,
  },
  {
    id: "spacing_loose",
    phrases: [
      /\bmore spacing\b/i,
      /\bairier\b/i,
      /\bmore breathing room\b/i,
      /\blooser\b/i,
      /\bmore room\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--loose",
    css: `
.content-card--loose {
  padding: 1.5rem;
  margin-top: 1rem;
}
`.trim(),
    priority: 70,
  },
  {
    id: "spacing_compact",
    phrases: [
      /\bcompact\b/i,
      /\btighter\b/i,
      /\bless spacing\b/i,
      /\bdenser\b/i,
      /\bmore compact\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--compact",
    css: `
.content-card--compact {
  width: min(220px, 100%);
  min-height: 220px;
  margin-inline: auto;
}
`.trim(),
    priority: 90,
  },
  {
    id: "size_tall",
    phrases: [
      /\btaller\b/i,
      /\bincrease height\b/i,
      /\bmake it taller\b/i,
      /\bmore height\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--tall",
    css: `
.content-card--tall {
  min-height: 320px;
}
`.trim(),
    priority: 90,
  },

  // ─────────────────────────────────────────
  // Wave 2
  // ─────────────────────────────────────────
  {
    id: "aura_ambient",
    phrases: [
      /\baura\b/i,
      /\bambient aura\b/i,
      /\bsoft aura\b/i,
      /\bsubtle aura\b/i,
      /\bambient glow\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--ambient-aura",
    css: `
.content-card--ambient-aura {
  box-shadow:
    0 0 18px rgba(0,212,255,0.12),
    0 0 34px rgba(124,92,255,0.08);
}
`.trim(),
    priority: 85,
  },
  {
    id: "depth_elevated",
    phrases: [
      /\belevated\b/i,
      /\bfloating\b/i,
      /\bmore depth\b/i,
      /\blifted\b/i,
      /\bmore dimensional\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--elevated",
    css: `
.content-card--elevated {
  box-shadow:
    0 14px 36px rgba(0,0,0,0.40),
    inset 0 1px 0 rgba(255,255,255,0.05);
}
`.trim(),
    priority: 75,
  },
  {
    id: "border_emphasis",
    phrases: [
      /\bstronger border\b/i,
      /\bmore defined border\b/i,
      /\boutlined\b/i,
      /\bframed\b/i,
      /\bemphasize the border\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--border-strong",
    css: `
.content-card--border-strong {
  border: 1px solid rgba(255,255,255,0.18);
}
`.trim(),
    priority: 70,
  },
  {
    id: "border_neon",
    phrases: [
      /\bneon border\b/i,
      /\bglowing border\b/i,
      /\belectric border\b/i,
      /\bneon edge\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--border-neon",
    css: `
.content-card--border-neon {
  border: 1px solid rgba(0,212,255,0.35);
  box-shadow:
    0 0 10px rgba(0,212,255,0.22),
    0 0 20px rgba(124,92,255,0.12);
}
`.trim(),
    priority: 85,
  },
  {
    id: "style_modern",
    phrases: [
      /\bmore modern\b/i,
      /\bcleaner\b/i,
      /\bsleeker\b/i,
      /\bmore polished\b/i,
      /\bclean modern\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--modern",
    css: `
.content-card--modern {
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow:
    0 10px 26px rgba(3,6,23,0.45),
    inset 0 1px 0 rgba(255,255,255,0.04);
}
`.trim(),
    priority: 70,
  },
  {
    id: "style_futuristic",
    phrases: [
      /\bfuturistic\b/i,
      /\bcyberpunk\b/i,
      /\bsci-fi\b/i,
      /\bhigh-tech\b/i,
      /\btechy\b/i,
      /\bmore futuristic\b/i,
      /\bfuturistic style\b/i,
      /\bfuturistic look\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--futuristic",
    css: `
.content-card--futuristic {
  border: 1px solid rgba(0,212,255,0.18);
  box-shadow:
    0 0 16px rgba(0,212,255,0.18),
    0 0 30px rgba(124,92,255,0.10);
  clip-path: polygon(
    0% 8%, 8% 0%,
    92% 0%, 100% 8%,
    100% 92%, 92% 100%,
    8% 100%, 0% 92%
  );
}
`.trim(),
    priority: 88,
  },
  {
    id: "obsidian_surface",
    phrases: [
      /\bobsidian\b/i,
      /\bobsidian blocks\b/i,
      /\bdark stone\b/i,
      /\bvolcanic glass\b/i,
      /\bobsidian style\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--obsidian",
    css: `
.content-card--obsidian {
  background:
    linear-gradient(180deg, rgba(18,20,28,0.92), rgba(8,10,16,0.96));
  border: 1px solid rgba(140,120,255,0.10);
  box-shadow:
    0 12px 28px rgba(0,0,0,0.45),
    inset 0 1px 0 rgba(255,255,255,0.03);
}
`.trim(),
    priority: 85,
  },

  // ─────────────────────────────────────────
  // Wave 3
  // ─────────────────────────────────────────
  {
    id: "style_premium",
    phrases: [
      /\bpremium\b/i,
      /\bluxurious\b/i,
      /\bmore expensive\b/i,
      /\bupscale\b/i,
      /\bhigh-end\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--premium",
    css: `
.content-card--premium {
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow:
    0 16px 40px rgba(0,0,0,0.42),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
`.trim(),
    priority: 72,
  },
  {
    id: "depth_embedded",
    phrases: [
      /\binset\b/i,
      /\bcarved in\b/i,
      /\bembedded\b/i,
      /\bpressed in\b/i,
      /\brecessed\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--embedded",
    css: `
.content-card--embedded {
  box-shadow:
    inset 0 2px 8px rgba(0,0,0,0.35),
    inset 0 1px 0 rgba(255,255,255,0.03);
}
`.trim(),
    priority: 65,
  },
  {
    id: "corners_rounded",
    phrases: [
      /\brounded\b/i,
      /\bsofter corners\b/i,
      /\bmore rounded\b/i,
      /\bsofter edges\b/i,
      /\bpill-like\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--rounded",
    css: `
.content-card--rounded {
  border-radius: 20px;
}
`.trim(),
    priority: 70,
  },
  {
    id: "shape_square",
    phrases: [
      /\bsquare\b/i,
      /\bmake it square\b/i,
      /\bequal width and height\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "content-card--square",
    css: `
.content-card--square {
  aspect-ratio: 1 / 1;
}
`.trim(),
    priority: 80,
  },

  // ─────────────────────────────────────────
  // Wave 4 — color / palette
  // ─────────────────────────────────────────
  {
    id: "palette_neon_blue",
    phrases: [
      /\bmore blue\b/i,
      /\bneon blue\b/i,
      /\bblue neon\b/i,
      /\bcooler blue\b/i,
      /\bmake (the )?(colors|coloring|palette) more blue\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--neon-blue",
    css: `
.theme--neon-blue {
  --accent: #38bdf8;
  --border: rgba(56,189,248,0.22);
}
`.trim(),
    priority: 82,
  },
  {
    id: "palette_cyber_purple",
    phrases: [
      /\bmore purple\b/i,
      /\bcyber purple\b/i,
      /\bpurple neon\b/i,
      /\bviolet cyber\b/i,
      /\bmake (the )?(colors|coloring|palette) more futuristic\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--cyber-purple",
    css: `
.theme--cyber-purple {
  --accent: #8b5cf6;
  --border: rgba(139,92,246,0.24);
}
`.trim(),
    priority: 86,
  },
  {
    id: "palette_obsidian",
    phrases: [
      /\bobsidian palette\b/i,
      /\bdarker palette\b/i,
      /\bdarker colors\b/i,
      /\bdeeper tones\b/i,
      /\bmake (it|the palette|the colors) darker\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--obsidian",
    css: `
.theme--obsidian {
  --bg: #090b12;
  --panel: #0f1118;
  --text: #e7ecf5;
  --muted: #8e9aae;
  --border: rgba(139,92,246,0.14);
}
`.trim(),
    priority: 88,
  },
  {
    id: "palette_warm_gold",
    phrases: [
      /\bgolden\b/i,
      /\bwarm gold\b/i,
      /\bluxury gold\b/i,
      /\bamber tones\b/i,
      /\bmake (the )?(colors|palette) warmer\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--warm-gold",
    css: `
.theme--warm-gold {
  --accent: #f59e0b;
  --border: rgba(245,158,11,0.22);
}
`.trim(),
    priority: 76,
  },
  {
    id: "palette_high_contrast",
    phrases: [
      /\bmore contrast\b/i,
      /\bhigh contrast\b/i,
      /\bstronger contrast\b/i,
      /\bmake the colors pop\b/i,
      /\bmore vivid\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--high-contrast",
    css: `
.theme--high-contrast {
  --text: #f8fbff;
  --muted: #b8c4d9;
  --border: rgba(255,255,255,0.20);
}
`.trim(),
    priority: 78,
  },
  {
    id: "palette_dutch_flag",
    phrases: [
      /\bcolors of nl\b/i,
      /\bcolors of the netherlands\b/i,
      /\bdutch flag\b/i,
      /\bcolors of the flag\b/i,
      /\bflag colors\b/i,
      /\bnetherlands palette\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--dutch-flag",
    css: `
.theme--dutch-flag {
  --bg: #ffefef;
  --panel: #ffffff;
  --text: #1f1f1f;
  --muted: #4b4b4b;
  --accent: #21468b;
  --border: rgba(33,70,139,0.18);
}
`.trim(),
    priority: 95,
  },
  {
    id: "navbar_dutch_flag",
    phrases: [
      /\bnav bar .* colors of the flag\b/i,
      /\bnavbar .* colors of the flag\b/i,
      /\bnavbar .* dutch flag\b/i,
      /\bnav bar .* dutch flag\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--navbar-dutch-flag",
    css: `
.theme--navbar-dutch-flag .site-header {
  background: linear-gradient(
    to bottom,
    #ae1c28 0 33.333%,
    #ffffff 33.333% 66.666%,
    #21468b 66.666% 100%
  );
}
`.trim(),
    priority: 96,
  },
  {
    id: "background_tulip_fields",
    phrases: [
      /\btulip fields\b/i,
      /\bbackground .* tulip\b/i,
      /\blike tulip fields\b/i,
      /\btulip field background\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--tulip-fields",
    css: `
.theme--tulip-fields body {
  background:
    linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0.02)),
    radial-gradient(circle at 15% 10%, rgba(255,255,255,0.35) 0 12%, transparent 12.5%),
    linear-gradient(to top, #2f7f3d 0 28%, #7fc35a 28% 34%, #f5f0e6 34% 36%, #d9edf7 36% 100%);
}
`.trim(),
    priority: 92,
  },
  {
    id: "background_windmills",
    phrases: [
      /\bwindmills?\b/i,
      /\bsolar windmills?\b/i,
      /\badd .* windmills? .* background\b/i,
      /\bwindmills? .* background\b/i,
    ],
    preferredTarget: "styles.css",
    patchMode: "ensure_class_and_css_rule",
    className: "theme--windmills",
    css: `
.theme--windmills body {
  background:
    linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0.02)),
    radial-gradient(circle at 15% 10%, rgba(255,255,255,0.35) 0 12%, transparent 12.5%),
    radial-gradient(circle at 72% 22%, rgba(255,255,255,0.22) 0 2.2%, transparent 2.4%),
    radial-gradient(circle at 84% 18%, rgba(255,255,255,0.22) 0 2.2%, transparent 2.4%),
    radial-gradient(circle at 72% 20%, transparent 0 3.1%, rgba(33,70,139,0.55) 3.1% 3.35%, transparent 3.35%),
    radial-gradient(circle at 84% 16%, transparent 0 3.1%, rgba(33,70,139,0.55) 3.1% 3.35%, transparent 3.35%),
    linear-gradient(to top, #2f7f3d 0 28%, #7fc35a 28% 34%, #f5f0e6 34% 36%, #d9edf7 36% 100%);
}
`.trim(),
    priority: 90,
  },
  
];

export function isBroadColorFollowupIntent(text: string): boolean {
  const input = String(text ?? "").trim().toLowerCase();
  if (!input) return false;

  return (
    /\b(color|colors|coloring|palette|theme|tones)\b/.test(input) ||
    /\bmake (it|them) darker\b/.test(input) ||
    /\bmake (it|them) brighter\b/.test(input) ||
    /\bmore contrast\b/.test(input) ||
    /\bmore vivid\b/.test(input)
  );
}



export function detectStyleRecipe(text: string): StyleRecipe | null {
  const input = String(text ?? "").trim();
  if (!input) return null;

  const ranked = STYLE_RECIPES
    .filter((recipe) => recipe.phrases.some((re) => re.test(input)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return ranked[0] ?? null;
}