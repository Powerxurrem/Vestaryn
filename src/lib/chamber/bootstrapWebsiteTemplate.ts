import type { WebsiteBootstrapBrief } from "@/lib/chamber/generation";

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSection(section: any) {
  const title = escapeHtml(section?.title ?? "");
  const body = escapeHtml(section?.body ?? "");
  const items = Array.isArray(section?.items) ? section.items : [];

  if (section?.type === "menu" || section?.type === "features" || section?.type === "services") {
    return `
      <section class="section card">
        <h2>${title}</h2>
        ${body ? `<p>${body}</p>` : ""}
        ${items.length ? `<ul>${items.map((x: string) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
      </section>
    `.trim();
  }

  return `
    <section class="section card">
      <h2>${title}</h2>
      ${body ? `<p>${body}</p>` : ""}
    </section>
  `.trim();
}

export function renderWebsiteIndexHtml(brief: WebsiteBootstrapBrief) {
  const sections = (brief.sections ?? []).slice(0, 3).map(renderSection).join("\n");

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

export function renderWebsiteStylesCss(brief: WebsiteBootstrapBrief) {
  return `:root {
  --bg: #0f172a;
  --panel: #111827;
  --text: #e5e7eb;
  --muted: #94a3b8;
  --accent: #f59e0b;
  --border: rgba(255,255,255,0.12);
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
  background: rgba(15, 23, 42, 0.75);
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

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.2rem;
  border-radius: 999px;
  background: var(--accent);
  color: #111827;
  font-weight: 700;
}

.button-ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
  padding-bottom: 3rem;
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