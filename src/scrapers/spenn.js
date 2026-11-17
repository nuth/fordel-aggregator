import { normalizeWhitespace } from './shared.js';

// Activation URLs require a member's spennId. Send users to the public
// extension page instead of publishing unusable personalized click links.
const SPENN_EXTENSION_URL = 'https://spenn.refunder.com/no/extension';

function buildDescription(store) {
  const description = normalizeWhitespace(store.spenn) || normalizeWhitespace(store.description) || null;
  const rate = store.rate;
  // At approximately 10 Spenn per krone, N Spenn per 10 kr equals N percent.
  if (rate?.fixed !== false || rate.unit !== 'per 10 kr' ||
      typeof rate.value !== 'number' || !Number.isFinite(rate.value) || rate.value < 0) {
    return description;
  }

  const percentage = rate.value.toLocaleString('nb-NO', { maximumFractionDigits: 10 });
  const prefix = rate.up_to ? 'Opptil ca.' : 'Ca.';
  const details = [description, '10 Spenn ≈ 1 kr'].filter(Boolean).join('; ');
  return `${prefix} ${percentage} % i Spenn (${details})`;
}

export async function scrapeSpennDiscounts(fetchCatalog, source) {
  const catalog = JSON.parse(await fetchCatalog(source.url));
  if (catalog?.market !== 'NO' || catalog?.locale !== 'nb' || !Array.isArray(catalog?.stores)) {
    throw new Error('Invalid Spenn Norwegian catalog');
  }

  return catalog.stores
    .filter((store) => typeof store?.name === 'string' && store.name.trim())
    .map((store) => ({
      name: normalizeWhitespace(store.name),
      description: buildDescription(store),
      categories: store.category ? [normalizeWhitespace(store.category)] : [],
      link: SPENN_EXTENSION_URL,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    }));
}
