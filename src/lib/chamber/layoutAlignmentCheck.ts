export function extractNavLinks(html: string): string[] {
  const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i);
  if (!navMatch) return [];

  const hrefs = [...navMatch[0].matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => String(m[1] ?? "").trim()
  );

  return hrefs;
}

export function hasHeaderShell(html: string) {
  return /<header[^>]*class=["'][^"']*site-header/i.test(html);
}

export function hasFooterShell(html: string) {
  return /<footer/i.test(html);
}

export function usesSharedStylesheet(html: string) {
  return /<link[^>]+href=["'][^"']*styles\.css["']/i.test(html);
}

export function checkLayoutAlignment(params: {
  canonicalHtml: string;
  targetHtml: string;
}) {
  const canonicalNav = extractNavLinks(params.canonicalHtml);
  const targetNav = extractNavLinks(params.targetHtml);

  const navMatches =
    canonicalNav.length > 0 &&
    canonicalNav.join("|") === targetNav.join("|");

  const ok =
    hasHeaderShell(params.targetHtml) &&
    hasFooterShell(params.targetHtml) &&
    usesSharedStylesheet(params.targetHtml) &&
    navMatches;

  return {
    ok,
    details: {
      canonicalNav,
      targetNav,
      headerOk: hasHeaderShell(params.targetHtml),
      footerOk: hasFooterShell(params.targetHtml),
      stylesheetOk: usesSharedStylesheet(params.targetHtml),
      navMatches,
    },
  };
}