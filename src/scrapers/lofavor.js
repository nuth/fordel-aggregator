import { asAbsoluteUrl, isStopWord, normalizeWhitespace, stripTags } from './shared.js';

const CATEGORY_PREFIXES = [
  ['/forsikring/', 'Forsikring'],
  ['/juridisk/', 'Juridisk'],
  ['/ferie-og-opplevelser/', 'Ferie og opplevelser'],
  ['/ferie-og-fritid/', 'Ferie og fritid'],
  ['/hus-og-hjem/', 'Hus og hjem'],
  ['/bank/', 'Bank'],
];

/**
 * LOfavør: extract benefit links by filtering nav anchors to known
 * benefit-category URL prefixes and inferring the category from the URL path.
 */
function extractLinksFromHtml(html, source) {
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

    results.push({ name, categories: [category], link });
  }

  return results;
}

function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return match ? normalizeWhitespace(match[1]) : null;
}

/**
 * LOfavør: scrape the home page to discover benefit links, then fetch each
 * individual benefit page to extract the meta description.
 */
export async function scrapeLofavorDiscounts(fetch, source) {
  const html = await fetch(source.url);
  const links = extractLinksFromHtml(html, source);

  const results = [];
  const concurrency = 4;

  for (let index = 0; index < links.length; index += concurrency) {
    const batch = links.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async ({ name, categories, link }) => {
        let description = null;
        try {
          const pageHtml = await fetch(link);
          description = extractMetaDescription(pageHtml);
        } catch (error) {
          console.warn(`Failed to fetch LOfavør page ${link}: ${error.message}`);
        }
        results.push({
          name,
          description,
          categories,
          link,
          source: source.name,
          sourceId: source.id,
          scrapedFrom: source.url,
        });
      }),
    );
  }

  return results;
}
