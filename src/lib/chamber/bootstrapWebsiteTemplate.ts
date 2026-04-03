import type { WebsiteBootstrapBrief } from "@/lib/chamber/generation";

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sectionAnchorId(section: { title?: string; type?: string }) {
  const raw = String(section?.title ?? section?.type ?? "section")
    .toLowerCase()
    .trim();

  return raw
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function renderSection(section: any) {
  const title = escapeHtml(section?.title ?? "");
  const body = escapeHtml(section?.body ?? "");
  const items = Array.isArray(section?.items) ? section.items : [];
  const anchorId = sectionAnchorId(section);

  return `
    <section id="${anchorId}" class="section card">
      <h2>${title}</h2>
      ${body ? `<p>${body}</p>` : ""}
      ${items.length ? `<ul>${items.map((x: string) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    </section>
  `.trim();
}

function renderHighlightChips(brief: WebsiteBootstrapBrief) {
  const items = (brief.sections ?? [])
    .slice(0, 3)
    .map((section) => {
      const title = escapeHtml(section?.title ?? "");
      const anchorId = sectionAnchorId(section);
      return `<a href="#${anchorId}" class="highlight-chip">${title}</a>`;
    })
    .join("\n");

  if (!items) return "";

  return `
    <section class="container highlights">
      ${items}
    </section>
  `.trim();
}

export function renderWebsiteIndexHtml(brief: WebsiteBootstrapBrief) {
  const sections = (brief.sections ?? []).slice(0, 6).map(renderSection).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(brief.siteTitle)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="container row">
      <div class="brand">${escapeHtml(brief.siteTitle)}</div>
      <nav class="nav">
        <a href="#home">Home</a>
        <a href="#content">Explore</a>
        ${brief.includeAboutPage ? `<a href="about.html">About</a>` : ""}
      </nav>
    </div>
  </header>

  <main id="home">
    <section class="hero">
      <div class="container hero-inner">
        <p class="eyebrow">${escapeHtml(brief.styleMood || "Welcome")}</p>
        <h1>${escapeHtml(brief.heroTitle)}</h1>
        <p class="hero-copy">${escapeHtml(brief.heroSubtitle)}</p>
        <div class="hero-actions">
          <a class="button" href="#content">${escapeHtml(brief.ctaText || "Learn More")}</a>
          ${brief.secondaryCtaText ? `<a class="button button-ghost" href="${brief.includeAboutPage ? "about.html" : "#content"}">${escapeHtml(brief.secondaryCtaText)}</a>` : ""}
        </div>
      </div>
    </section>

    ${renderHighlightChips(brief)}

    <section id="content" class="container section-grid">
      ${sections}
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>© ${escapeHtml(brief.siteTitle)}</p>
    </div>
  </footer>
</body>
</html>`;
}

export function renderWebsiteAboutHtml(brief: WebsiteBootstrapBrief) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>About | ${escapeHtml(brief.siteTitle)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="container row">
      <div class="brand">${escapeHtml(brief.siteTitle)}</div>
      <nav class="nav">
        <a href="index.html">Home</a>
        <a href="about.html">About</a>
      </nav>
    </div>
  </header>

  <main class="container page">
    <section class="card">
      <h1>About</h1>
      <p>${escapeHtml(brief.heroSubtitle)}</p>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>© ${escapeHtml(brief.siteTitle)}</p>
    </div>
  </footer>
</body>
</html>`;
}

function resolveBootstrapPalette(brief: WebsiteBootstrapBrief) {
  const text = `${brief.siteTitle} ${brief.heroTitle} ${brief.heroSubtitle} ${brief.styleMood ?? ""} ${brief.paletteHint ?? ""} ${brief.siteType ?? ""} ${brief.visualStyle ?? ""}`.toLowerCase();

  const looksTravel =
    /\b(italy|netherlands|travel|guide|explore|destination|tourism|culture|city|cities|country)\b/.test(text);

  const looksFuturistic =
    /\b(futuristic|cyber|tech|ai|startup|saas|platform|software)\b/.test(text);

const looksArtGallery =
  /\b(art|gallery|painting|paintings|artist|artists|exhibition|museum|curated|editorial)\b/.test(text);

  const looksLuxury =
    /\b(luxury|premium|gold|elegant|high-end)\b/.test(text);

if (looksArtGallery) {
  return {
    bg: "#f6f1e8",
    panel: "#fffaf3",
    text: "#2b2118",
    muted: "#6f6254",
    accent: "#8c6a43",
    border: "rgba(43, 33, 24, 0.12)",
    buttonText: "#fffaf3",
    headerBg: "rgba(246, 241, 232, 0.88)",
  };
}

  if (looksTravel) {
    return {
      bg: "#f8faf5",
      panel: "#ffffff",
      text: "#1f2937",
      muted: "#6b7280",
      accent: "#008C45",
      border: "rgba(31, 41, 55, 0.12)",
      buttonText: "#ffffff",
      headerBg: "rgba(248, 250, 245, 0.9)",
    };
  }

  if (looksLuxury) {
    return {
      bg: "#14110f",
      panel: "#1c1815",
      text: "#f5efe6",
      muted: "#c6b9a7",
      accent: "#d4a84f",
      border: "rgba(212, 168, 79, 0.18)",
      buttonText: "#111827",
      headerBg: "rgba(20, 17, 15, 0.82)",
    };
  }

  if (looksFuturistic) {
    return {
      bg: "#0b1020",
      panel: "#111827",
      text: "#e5f0ff",
      muted: "#94a3b8",
      accent: "#38bdf8",
      border: "rgba(56, 189, 248, 0.18)",
      buttonText: "#081018",
      headerBg: "rgba(11, 16, 32, 0.82)",
    };
  }

  return {
    bg: "#0f172a",
    panel: "#111827",
    text: "#e5e7eb",
    muted: "#94a3b8",
    accent: "#f59e0b",
    border: "rgba(255,255,255,0.12)",
    buttonText: "#111827",
    headerBg: "rgba(15, 23, 42, 0.75)",
  };
}

export function renderWebsiteStylesCss(brief: WebsiteBootstrapBrief) {
  const palette = resolveBootstrapPalette(brief);
  return `:root {
  --bg: ${palette.bg};
  --panel: ${palette.panel};
  --text: ${palette.text};
  --muted: ${palette.muted};
  --accent: ${palette.accent};
  --border: ${palette.border};
  --max-width: 1100px;
  --radius: 18px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

a { color: inherit; text-decoration: none; }
.container {
  width: min(var(--max-width), calc(100% - 2rem));
  margin: 0 auto;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.site-header {
  position: sticky;
  top: 0;
  backdrop-filter: blur(10px);
  background: ${palette.headerBg};
  border-bottom: 1px solid var(--border);
}

.site-header .container {
  padding: 1rem 0;
}

.brand {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.nav {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.hero {
  padding: 5rem 0 3rem;
}

.hero-inner {
  max-width: 760px;
}

.eyebrow {
  color: var(--accent);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.82rem;
}

h1, h2 {
  line-height: 1.15;
  margin: 0 0 1rem;
}

h1 {
  font-size: clamp(2.4rem, 6vw, 4.5rem);
}

.hero-copy,
.card p,
.card li {
  color: var(--muted);
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1.5rem;
}

.highlights {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-bottom: 2rem;
}

.highlight-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.92rem;
  transition:
  transform 140ms ease,
  border-color 140ms ease,
  background 140ms ease,
  box-shadow 140ms ease;
}

.highlight-chip:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
}

.highlight-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.2rem;
  border-radius: 999px;
  background: var(--accent);
  color: ${palette.buttonText};
  font-weight: 700;
}

.button-ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  padding-bottom: 3rem;
}

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

.section,
.page {
  padding: 2rem 0 3rem;
}

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
}

ul {
  padding-left: 1.2rem;
  margin: 0.75rem 0 0;
}

.site-footer {
  border-top: 1px solid var(--border);
  padding: 1.5rem 0 2.5rem;
  color: var(--muted);
}`;
}