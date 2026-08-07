import { asAbsoluteUrl, isStopWord, normalizeWhitespace, stripTags } from './shared.js';

/**
 * LOfavør: extract benefits by filtering nav anchors to known benefit-category
 * URL prefixes and inferring the category from the URL path.
 */
export function extractLofavorDiscounts(html, source) {
  const CATEGORY_PREFIXES = [
    ['/forsikring/', 'Forsikring'],
    ['/juridisk/', 'Juridisk'],
    ['/ferie-og-opplevelser/', 'Ferie og opplevelser'],
    ['/ferie-og-fritid/', 'Ferie og fritid'],
    ['/hus-og-hjem/', 'Hus og hjem'],
    ['/bank/', 'Bank'],
  ];

  const seen = new Set();
  const results = [];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, inner] = match;

    let pathname;
    try {
      pathname = new URL(href, source.baseUrl).pathname;
    } catch {
      continue;
    }

    let category = null;
    for (const [prefix, cat] of CATEGORY_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        category = cat;
        break;
      }
    }
    if (!category) continue;

    const name = normalizeWhitespace(stripTags(inner));
    if (!name || isStopWord(name) || name.length > 80) continue;

    const link = asAbsoluteUrl(source.baseUrl, href);
    if (!link) continue;

    const key = `${name}::${pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name,
      description: null,
      categories: [category],
      link,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }

  return results;
}
