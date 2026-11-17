import { normalizeWhitespace } from './shared.js';

// Activation URLs require a member's spennId. Send users to the public
// extension page instead of publishing unusable personalized click links.
const SPENN_EXTENSION_URL = 'https://spenn.refunder.com/no/extension';

export async function scrapeSpennDiscounts(fetchCatalog, source) {
  const catalog = JSON.parse(await fetchCatalog(source.url));
  if (catalog?.market !== 'NO' || catalog?.locale !== 'nb' || !Array.isArray(catalog?.stores)) {
    throw new Error('Invalid Spenn Norwegian catalog');
  }

  return catalog.stores
    .filter((store) => typeof store?.name === 'string' && store.name.trim())
    .map((store) => ({
      name: normalizeWhitespace(store.name),
      description: normalizeWhitespace(store.spenn) || normalizeWhitespace(store.description) || null,
      categories: store.category ? [normalizeWhitespace(store.category)] : [],
      link: SPENN_EXTENSION_URL,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    }));
}
