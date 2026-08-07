import { asAbsoluteUrl, normalizeWhitespace } from './shared.js';

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * NITO Medlemsfordeler: the benefit list is embedded as a JSON string in the
 * data-props attribute of the member-benefit-list container element.
 */
export function extractNitoDiscounts(html, source) {
  const match = html.match(/class="member-benefit-list"[^>]*>[\s\S]*?<[^>]+\s+data-props="([^"]+)"/);
  if (!match) return [];

  let data;
  try {
    data = JSON.parse(decodeHtmlEntities(match[1]));
  } catch {
    return [];
  }

  if (!Array.isArray(data?.memberBenefitList)) return [];

  const seen = new Set();
  const results = [];

  for (const group of data.memberBenefitList) {
    const categoryName = group?.category?.name ?? '';
    const benefits = group?.memberBenefitsDetails ?? [];

    for (const benefit of benefits) {
      const contentLink = benefit?.contentLink;
      if (!contentLink || seen.has(contentLink)) continue;
      seen.add(contentLink);

      const name = normalizeWhitespace(benefit.heading ?? '');
      if (!name) continue;

      const categories = Array.isArray(benefit.tags) && benefit.tags.length > 0
        ? benefit.tags.map((t) => normalizeWhitespace(t)).filter(Boolean)
        : categoryName ? [categoryName] : [];

      const link = asAbsoluteUrl(source.baseUrl, contentLink);
      if (!link) continue;

      results.push({
        name,
        description: null,
        categories,
        link,
        source: source.name,
        sourceId: source.id,
        scrapedFrom: source.url,
      });
    }
  }

  return results;
}
