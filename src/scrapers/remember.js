import { asAbsoluteUrl, normalizeWhitespace } from './shared.js';

/**
 * Remember Reward: parse the embedded __NEXT_DATA__ JSON which contains a
 * complete store list with descriptions, affiliate URLs, and category mappings.
 */
export function extractRememberRewardDiscounts(html, source) {
  const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return [];

  let data;
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch {
    return [];
  }

  const pp = data?.props?.pageProps;
  if (!pp?.stores) return [];

  const storeCats = new Map();
  for (const cat of pp.categories ?? []) {
    const catName = cat.title || cat.name || '';
    for (const shop of cat.shops ?? []) {
      if (!storeCats.has(shop.id)) storeCats.set(shop.id, []);
      storeCats.get(shop.id).push(catName);
    }
  }

  return pp.stores
    .filter((store) => store.enabled && store.name)
    .map((store) => ({
      name: normalizeWhitespace(store.name),
      description: store.description ? normalizeWhitespace(store.description) : null,
      categories: storeCats.get(store.id) ?? [],
      link: store.affiliateUrl || asAbsoluteUrl(source.baseUrl, store.shopUrl) || source.url,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    }));
}
