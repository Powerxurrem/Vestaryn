import OpenAI from "openai";
import { stripCodeFences } from "@/lib/vault/utils";
import { isLayoutAlignmentIntent } from "@/lib/chamber/intent";

function looksTruncatedHtml(text: string) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return true;

  if (t.includes("<html") && !t.includes("</html>")) return true;
  if (t.includes("<body") && !t.includes("</body>")) return true;
  if (t.includes("<head") && !t.includes("</head>")) return true;
  if ((t.match(/<style\b/g) ?? []).length !== (t.match(/<\/style>/g) ?? []).length) return true;
  if ((t.match(/<script\b/g) ?? []).length !== (t.match(/<\/script>/g) ?? []).length) return true;

  return false;
}

function looksTruncatedPython(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return true;

  const openParen = (t.match(/\(/g) ?? []).length;
  const closeParen = (t.match(/\)/g) ?? []).length;
  const openBracket = (t.match(/\[/g) ?? []).length;
  const closeBracket = (t.match(/\]/g) ?? []).length;
  const openBrace = (t.match(/\{/g) ?? []).length;
  const closeBrace = (t.match(/\}/g) ?? []).length;

  const tripleSingle = (t.match(/'''/g) ?? []).length;
  const tripleDouble = (t.match(/"""/g) ?? []).length;

  return (
    openParen !== closeParen ||
    openBracket !== closeBracket ||
    openBrace !== closeBrace ||
    tripleSingle % 2 !== 0 ||
    tripleDouble % 2 !== 0
  );
}

function looksTruncatedCss(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return true;

  const openBraces = (t.match(/\{/g) ?? []).length;
  const closeBraces = (t.match(/\}/g) ?? []).length;

  return openBraces !== closeBraces;
}

function looksTruncatedJsLike(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return true;

  const openCurly = (t.match(/\{/g) ?? []).length;
  const closeCurly = (t.match(/\}/g) ?? []).length;
  const openParen = (t.match(/\(/g) ?? []).length;
  const closeParen = (t.match(/\)/g) ?? []).length;
  const openBracket = (t.match(/\[/g) ?? []).length;
  const closeBracket = (t.match(/\]/g) ?? []).length;

  return (
    openCurly !== closeCurly ||
    openParen !== closeParen ||
    openBracket !== closeBracket
  );
}

function detectTruncation(path: string, text: string) {
  const p = String(path ?? "").toLowerCase();

  if (p.endsWith(".html")) return looksTruncatedHtml(text);
  if (p.endsWith(".css")) return looksTruncatedCss(text);
  if (p.endsWith(".py")) return looksTruncatedPython(text);
  if (p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".ts") || p.endsWith(".tsx")) {
    return looksTruncatedJsLike(text);
  }

  return false;
}




export async function generateSplitFileContents(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  sourcePath: string;
  sourceContent: string;
  targetPaths: string[];
}) {
  const prompt = `
You are splitting one repository file into multiple files.

Return ONLY valid JSON in this exact shape:
{
  "files": [
    { "path": "target/path.ext", "content": "full file content" }
  ]
}

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include any text before or after the JSON.
- Produce one entry for each requested target path.
- Preserve valid syntax.
- The result should satisfy the user's split request.

Source file:
${opts.sourcePath}

Requested target paths:
${opts.targetPaths.map((p) => `- ${p}`).join("\n")}

User request:
${opts.userRequest}

Source content:
<<<FILE
${opts.sourceContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 3200,
  });

  const raw = (resp.output_text || "").trim();
  console.log("[extract_orchestration raw]", raw.slice(0, 4000));

  const cleaned = stripCodeFences(raw).trim();
  console.log("[extract_orchestration cleaned]", cleaned.slice(0, 4000));

  let parsed: any;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      throw new Error(`extract JSON parse failed: ${e?.message ?? "unknown parse error"}`);
    }
  
  const files = Array.isArray(parsed?.files) ? parsed.files : [];

  return files
    .filter((f: any) => typeof f?.path === "string" && typeof f?.content === "string")
    .map((f: any) => ({
      path: String(f.path).trim(),
      content: String(f.content),
    }));
}

function extractJsonObject(text: string) {
  const s = String(text ?? "").trim();

  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fenced?.[1]?.trim() ?? s;

  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output");
  }

  return unfenced.slice(first, last + 1);
}

export async function generateExtractHelpersResult(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  sourcePath: string;
  sourceContent: string;
  targetPath: string;
}) {
  const prompt = `
You are extracting pure helper functions from one repository file into a separate module.

Return ONLY valid JSON in this exact shape:
{
  "targetContent": "full contents of the new helper module",
  "sourceContent": "full rewritten contents of the original source file"
}

Hard rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include any text before or after the JSON.
- sourceContent must be the FULL rewritten contents of the original source file.
- targetContent must be the FULL contents of the new helper module.
- Do not use placeholders.
- Do not use ellipses.
- Do not use comments like:
  - "rest of file unchanged"
  - "other code remains unchanged"
  - "..."
  - "omitted"
  - "the rest of the file"
- Do not return partial files.
- Do not shorten the source file by summarizing unchanged sections.
- Preserve runtime behavior.
- Move only pure helper functions and intent-detection helpers.
- Do not move route handlers, streaming logic, Supabase calls, OpenAI calls, verification functions, vault_* functions, or command-handling branches.
- Keep all non-extracted logic in sourceContent.
- Update imports in sourceContent so it compiles.
- Use the import path "@/lib/chamber/chatIntent" from the source file.
- Keep function names unchanged unless absolutely necessary.
- If you cannot produce a complete valid extraction, return this exact JSON:
  {"targetContent":"","sourceContent":""}

Source file:
${opts.sourcePath}

Target helper module:
${opts.targetPath}

User request:
${opts.userRequest}

Source content:
<<<FILE
${opts.sourceContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 5200,
  });

  const raw = resp.output_text ?? "";
  const jsonText = extractJsonObject(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`Model returned invalid JSON: ${e?.message ?? "unknown parse error"}`);
  }

  return {
    targetContent: String(parsed?.targetContent ?? ""),
    sourceContent: String(parsed?.sourceContent ?? ""),
  };
}

export type WebsiteSectionBrief = {
  type: "about" | "features" | "services" | "menu" | "contact";
  title: string;
  body?: string;
  items?: string[];
};

export type WebsiteBootstrapBrief = {
  siteTitle: string;
  siteType: string;
  tone: string;
  visualStyle: string;
  heroTitle: string;
  heroSubtitle: string;
  ctaText: string;
  secondaryCtaText?: string;
  styleMood: string;
  paletteHint?: string;
  includeAboutPage: boolean;
  sections: WebsiteSectionBrief[];
};

export async function generateWebsiteBootstrapBrief(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
}) {
  const prompt = `
You are creating a small structured brief for an initial static website bootstrap.

Return ONLY valid JSON in this exact shape:
{
  "siteTitle": "string",
  "siteType": "string",
  "tone": "string",
  "visualStyle": "string",
  "heroTitle": "string",
  "heroSubtitle": "string",
  "ctaText": "string",
  "secondaryCtaText": "string",
  "styleMood": "string",
  "paletteHint": "string",
  "includeAboutPage": true,
  "sections": [
    {
      "type": "about",
      "title": "string",
      "body": "string",
      "items": ["string"]
    }
  ]
}

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Keep the result compact.
- Prefer 1 to 3 sections maximum.
- Use only section types: about, features, services, menu, contact.
- Every string must be fully filled.
- No placeholders.
- No ellipses.
- Do not use trailing commas.

User request:
${opts.userRequest}
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: 1200,
  });

  const raw = resp.output_text ?? "";

  try {
    const jsonText = extractJsonObject(raw);
    const parsed = JSON.parse(jsonText);

    const fallback = fallbackWebsiteBootstrapBrief(opts.userRequest);

    return {
      siteTitle: String(parsed?.siteTitle ?? "").trim() || fallback.siteTitle,
      siteType: String(parsed?.siteType ?? "").trim() || fallback.siteType,
      tone: String(parsed?.tone ?? "").trim() || fallback.tone,
      visualStyle: String(parsed?.visualStyle ?? "").trim() || fallback.visualStyle,
      heroTitle: String(parsed?.heroTitle ?? "").trim() || fallback.heroTitle,
      heroSubtitle: String(parsed?.heroSubtitle ?? "").trim() || fallback.heroSubtitle,
      ctaText: String(parsed?.ctaText ?? "").trim() || fallback.ctaText,
      secondaryCtaText:
        String(parsed?.secondaryCtaText ?? "").trim() || fallback.secondaryCtaText || "",
      styleMood: String(parsed?.styleMood ?? "").trim() || fallback.styleMood,
      paletteHint: String(parsed?.paletteHint ?? "").trim() || fallback.paletteHint || "",
      includeAboutPage:
        typeof parsed?.includeAboutPage === "boolean"
          ? parsed.includeAboutPage
          : fallback.includeAboutPage,
      sections:
        Array.isArray(parsed?.sections) && parsed.sections.length > 0
          ? parsed.sections
          : fallback.sections,
    };
  } catch (e: any) {
    console.log("[website_brief parse failed]", {
      message: e?.message,
      rawHead: raw.slice(0, 1200),
    });

    return fallbackWebsiteBootstrapBrief(opts.userRequest);
  }
}

function fallbackWebsiteBootstrapBrief(userRequest: string): WebsiteBootstrapBrief {
  const raw = String(userRequest ?? "").trim();
  const s = raw.toLowerCase();

  const includeAboutPage = s.includes("about");

  const hasGold = /\bgold|golden|luxury|premium\b/.test(s);
  const hasPictures = /\bpictures|images|photos|gallery\b/.test(s);

  function titleCase(input: string) {
    return input
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function extractTopic(text: string) {
    const patterns = [
      /website about ([a-z0-9\s-]+)/i,
      /site about ([a-z0-9\s-]+)/i,
      /page about ([a-z0-9\s-]+)/i,
      /for ([a-z0-9\s-]+) website/i,
      /about ([a-z0-9\s-]+)/i,
    ];

    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) {
        return m[1]
          .replace(/\b(with|and|that|which)\b.*$/i, "")
          .trim();
      }
    }

    return "";
  }

  const topic = extractTopic(raw);
  const topicTitle = topic ? titleCase(topic) : "Landing Page";

  if (s.includes("pokemon")) {
    return {
      siteTitle: "PokeHub",
      siteType: "fan_site",
      tone: "playful",
      visualStyle: "playful",
      heroTitle: "Discover Your Favorite Pokémon",
      heroSubtitle:
        "A playful landing page for exploring featured Pokémon, trainers, and adventures.",
      ctaText: "Explore Now",
      secondaryCtaText: includeAboutPage ? "About" : "",
      styleMood: "playful modern",
      paletteHint: "yellow blue red",
      includeAboutPage,
      sections: [
        {
          type: "features",
          title: "Featured Pokémon",
          body: "Spotlight a few popular characters and quick facts.",
          items: ["Pikachu", "Charmander", "Squirtle"],
        },
        {
          type: "about",
          title: "Why Fans Love It",
          body: "Fast, bright, and easy to explore.",
        },
      ],
    };
  }

  if (s.includes("coffee")) {
    return {
      siteTitle: "Morning Roast",
      siteType: "restaurant",
      tone: "minimal",
      visualStyle: "elegant",
      heroTitle: "Coffee for Calm Mornings",
      heroSubtitle:
        "A cozy landing page for a café, roastery, or coffee brand.",
      ctaText: "View Menu",
      secondaryCtaText: includeAboutPage ? "About" : "",
      styleMood: "warm minimal",
      paletteHint: "cream brown",
      includeAboutPage,
      sections: [
        {
          type: "services",
          title: "What We Serve",
          body: "Simple, quality coffee and fresh pastries.",
          items: ["Espresso", "Pour over", "Pastries"],
        },
      ],
    };
  }

  if (s.includes("portfolio")) {
    return {
      siteTitle: "Portfolio",
      siteType: "portfolio",
      tone: "professional",
      visualStyle: "clean",
      heroTitle: "Designing Clear, Useful Experiences",
      heroSubtitle:
        "A simple starter portfolio for showcasing work and background.",
      ctaText: "View Work",
      secondaryCtaText: "About",
      styleMood: "clean professional",
      paletteHint: "slate blue",
      includeAboutPage: true,
      sections: [
        {
          type: "features",
          title: "Selected Work",
          body: "Highlight a few strong projects or case studies.",
          items: ["Project One", "Project Two", "Project Three"],
        },
      ],
    };
  }

  const styleMood = hasGold ? "elegant warm" : "clean modern";
  const paletteHint = hasGold ? "gold black cream" : "blue slate";

  const siteType: WebsiteBootstrapBrief["siteType"] =
    /\bportfolio|work|project\b/i.test(raw)
      ? "portfolio"
      : /\bmenu|food|drink|coffee|cafe|restaurant\b/i.test(raw)
      ? "restaurant"
      : /\bproduct|app|saas|tool\b/i.test(raw)
      ? "product"
      : /\bbusiness|company|agency|studio\b/i.test(raw)
      ? "business"
      : /\bpokemon|fan\b/i.test(raw)
      ? "fan_site"
      : "general";

  const tone: WebsiteBootstrapBrief["tone"] =
    hasGold
      ? "luxury"
      : /\bfun|playful|cute|pokemon\b/i.test(raw)
      ? "playful"
      : /\bminimal|minimalist|clean\b/i.test(raw)
      ? "minimal"
      : /\bbold|strong|dramatic\b/i.test(raw)
      ? "bold"
      : "professional";

  const visualStyle: WebsiteBootstrapBrief["visualStyle"] =
    hasGold
      ? "premium"
      : /\bdark\b/i.test(raw)
      ? "dark"
      : /\bplayful|pokemon\b/i.test(raw)
      ? "playful"
      : /\belegant|luxury\b/i.test(raw)
      ? "elegant"
      : "clean";

  const heroTitle = topic
    ? `${topicTitle}`
    : "Build Something Clear and Focused";

  const heroSubtitle = topic
    ? `A simple website focused on ${topic.toLowerCase()}${
        hasPictures ? " with a visual gallery feel" : ""
      }.`
    : "A clean, simple website starter.";

  const sectionTitle = topic ? `About ${topicTitle}` : "Getting Started";

  const sectionBody = topic
    ? `A focused introduction to ${topic.toLowerCase()} with clear sections and a simple layout.`
    : "A reliable starter layout with room to customize.";

  const ctaText =
    /\b(book|appointment|reserve)\b/i.test(raw)
      ? "Book Now"
      : /\b(menu|food|drink|coffee)\b/i.test(raw)
      ? "View Menu"
      : /\bportfolio|work|project\b/i.test(raw)
      ? "View Work"
      : /\bpokemon|fan|gallery|images|pictures\b/i.test(raw)
      ? "Explore"
      : "Get Started";

  return {
    siteTitle: topicTitle || "Landing Page",
    siteType,
    tone,
    visualStyle,
    heroTitle,
    heroSubtitle,
    ctaText,
    secondaryCtaText: includeAboutPage ? "About" : "",
    styleMood,
    paletteHint,
    includeAboutPage,
    sections: [
      {
        type: "about" as const,
        title: sectionTitle,
        body: sectionBody,
      },
      ...(hasPictures
        ? [
            {
              type: "features" as const,
              title: "Gallery Highlights",
              body: "A visual section for featured images and themed highlights.",
              items: [
                "Featured image",
                "Highlighted section",
                "Visual showcase",
              ],
            },
          ]
        : []),
    ].slice(0, 3),
  };
}

export async function generateNewFileContent(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  maxOutputTokens?: number;
}) {
  const prompt = `
You are creating a NEW repository file.

Return ONLY the full file contents.

Rules:
- Do not include markdown fences.
- Do not include explanation.
- Do not include [Observation]/[Assessment]/[Action].
- Do not include JSON.
- Produce valid code/content for the target path.

Target file: ${opts.path}

User request:
${opts.userRequest}
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: opts.maxOutputTokens ?? 10000,
  });

  const text = (resp.output_text || "").trim();

  if (detectTruncation(opts.path, text)) {
    console.log("[generation truncation_detected]", {
      path: opts.path,
      mime: opts.mime,
      textLen: text.length,
      head: text.slice(0, 300),
      tail: text.slice(-500),
    });

    throw new Error(`Generated file appears truncated: ${opts.path}`);
  }

  return text;
}

export async function generateRewrittenFileContent(opts: {
  openai: OpenAI;
  model: string;
  userRequest: string;
  path: string;
  mime: string;
  currentContent: string;
  maxOutputTokens?: number;
}) {
  const {
    openai,
    model,
    userRequest,
    path,
    mime,
    currentContent,
    maxOutputTokens,
  } = opts;

  const isHtmlFile =
    /\.(html?)$/i.test(path) || String(mime ?? "").includes("html");

  const isCssFile =
    /\.css$/i.test(path) || String(mime ?? "").includes("text/css");

  const isLayoutAlignment = isLayoutAlignmentIntent(userRequest);

  const htmlCssCoordinationRules = isHtmlFile
    ? `
HTML/CSS coordination rules:
- Keep styling out of inline style attributes whenever possible.
- Prefer semantic structure and class names over inline presentation.
- If a styles.css file exists in the repo, assume shared styling should live there.
- Do not solve layout requests by stuffing large inline style attributes into HTML.
- Only use inline styles for tiny one-off exceptions if absolutely necessary.
- If the request implies visual redesign across the page, preserve clean HTML structure and rely on existing CSS classes or simple new class hooks.
- Do not add external image placeholders, fake CDN assets, or dummy remote banners unless explicitly requested.
- Do not add fake forms, fake newsletter sections, or fake contact flows unless explicitly requested.
- Improve structure, hierarchy, sections, and reuse rather than adding bloat.
- Preserve existing copy and section purpose unless the user explicitly asks to change them.
- Do not reference local assets, images, icons, logos, SVGs, scripts, or files that were not explicitly requested or already known to exist.
- Do not invent paths like assets/logo.svg, images/..., scripts/..., or icons/... unless you are also creating those files in the same proposal set.
- If no local asset exists, prefer pure HTML/CSS structure without image dependencies.
`.trim()
    : "";

  const cssLocalizationRules = isCssFile
    ? `
CSS rewrite rules:
- Prefer the smallest localized edit possible.
- If the request targets a specific area (for example nav, header, hero, footer, button, card), only modify selectors relevant to that area.
- Keep unrelated selectors unchanged.
- Do not restyle the whole file for a local visual request.
- Preserve existing variables, spacing, typography, and unrelated colors unless the request requires changing them.
- When possible, change only the declarations inside the most relevant existing selector block.
- Do not rename selectors, restructure the stylesheet, or reorder large sections unless necessary.
- Return the full file, but keep the actual diff minimal.
`.trim()
    : "";

  const htmlLocalizationRules = isHtmlFile
    ? `
HTML rewrite rules:
- Prefer the smallest localized edit possible.
- If the request targets one section, modify only that section.
- Keep unrelated sections and copy unchanged.
- Preserve document structure unless the request clearly asks for structural changes.
`.trim()
    : "";

  const htmlAlignmentRules =
    isHtmlFile && isLayoutAlignment
      ? `
HTML layout alignment rules:
- This is a layout-alignment request, not a full rewrite.
- Preserve all page-specific content, sections, and copy unless the request explicitly asks otherwise.
- Do NOT regenerate the whole page.
- Only align shared structural elements when needed, such as:
  - header
  - nav
  - topbar
  - footer
  - top-level layout wrappers
  - shared class structure
- Keep unique body sections intact.
- Do not replace existing sections with generic substitutes.
- Do not rewrite text just to make pages feel stylistically similar.
- Make the minimum structural edits needed to align the shared layout language.
`.trim()
      : "";

  const prompt = `
You are rewriting a single repository file.

Rules:
- Return ONLY the full rewritten file contents.
- Do not include markdown fences.
- Do not include explanation.
- Preserve the user's intent.
- Make the smallest good change that satisfies the request.
- Prefer a minimal diff.
- Keep unrelated parts unchanged.
- Do not truncate the file.
- Keep the file valid for its type.
- Do not invent major new content, features, sections, forms, or assets unless the user asked for them.

${htmlCssCoordinationRules}

${cssLocalizationRules}

${htmlLocalizationRules}

${htmlAlignmentRules}

User request:
${userRequest}

Target file:
${path}

Mime:
${mime}

Current file content:
<<<FILE
${currentContent}
FILE
>>>
`.trim();

  const resp = await opts.openai.responses.create({
    model: opts.model,
    input: prompt,
    max_output_tokens: opts.maxOutputTokens ?? 10000,
  });

  const text = (resp.output_text || "").trim();

  if (detectTruncation(opts.path, text)) {
    throw new Error(`Rewritten file appears truncated: ${opts.path}`);
  }

  return text;
}