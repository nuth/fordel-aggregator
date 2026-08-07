import { normalizeWhitespace } from './shared.js';

/**
 * OBOS Medlemsfordeler: the page uses Next.js App Router (RSC wire format).
 * The full benefit list including names, slugs, categories and ingress text is
 * embedded in the largest __next_f.push block as a JSON-encoded string.
 */
export function extractObosDiscounts(html, source) {
  let decoded = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)) {
    if (match[1].length > 50_000) {
      try {
        decoded = JSON.parse('"' + match[1] + '"');
        if (decoded.includes('member_memberBenefit')) break;
      } catch {
        decoded = '';
      }
    }
  }
  if (!decoded) return [];

  const benefitBasePath = new URL(source.url).pathname.split('?')[0];
  const benefitPattern =
    /"_type":"member_memberBenefit".*?"categories":(\[[^\]]*\]).*?"ingress":"((?:[^"\\]|\\.)*)".*?"title":"([^"]+)"\}.*?"current":"([^"]+)"/gs;

  const results = [];
  const seen = new Set();

  for (const match of decoded.matchAll(benefitPattern)) {
    const [, categoriesJson, ingress, title, slug] = match;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const categories = [...categoriesJson.matchAll(/"name":"([^"]+)"/g)].map((category) => category[1]);
    const name = normalizeWhitespace(title);
    const description = ingress ? normalizeWhitespace(ingress.replace(/\\n/g, ' ').replace(/\\"/g, '"')) : null;

    results.push({
      name,
      description,
      categories,
      link: `${source.baseUrl}${benefitBasePath}/${slug}`,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }

  return results;
}
