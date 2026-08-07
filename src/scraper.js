import { scrapeLofavorDiscounts } from './scrapers/lofavor.js';
import { scrapeKlarnaDiscounts } from './scrapers/klarna.js';
import { extractNitoDiscounts } from './scrapers/nito.js';
import { extractObosDiscounts } from './scrapers/obos.js';
import { extractRememberRewardDiscounts } from './scrapers/remember.js';
import { extractDiscountsFromHtml, fetchHtml } from './scrapers/shared.js';
import { scrapeTrumfDiscounts } from './scrapers/trumf.js';

const SOURCE_EXTRACTORS = {
  'remember-reward': extractRememberRewardDiscounts,
  'obos-medlemsfordeler': extractObosDiscounts,
  'nito-medlemsfordeler': extractNitoDiscounts,
};

const SOURCE_SCRAPERS = {
  lofavor: scrapeLofavorDiscounts,
  'trumf-netthandel': scrapeTrumfDiscounts,
  'klarna-cashback': scrapeKlarnaDiscounts,
};

export { extractDiscountsFromHtml };

export async function scrapeSource(source, clock = () => new Date()) {
  const scrapedAt = clock().toISOString();

  try {
    let discounts;

    const customScraper = SOURCE_SCRAPERS[source.id];
    const customExtractor = SOURCE_EXTRACTORS[source.id];

    if (customScraper) {
      const raw = await customScraper(fetchHtml, source);
      discounts = raw.map((entry) => ({ ...entry, lastScraped: scrapedAt }));
    } else {
      const html = await fetchHtml(source.url);
      const extract = customExtractor ?? extractDiscountsFromHtml;
      discounts = extract(html, source).map((entry) => ({ ...entry, lastScraped: scrapedAt }));
    }

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      scrapedAt,
      count: discounts.length,
      discounts,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? [error.message, error.cause?.message].filter(Boolean).join(': ')
        : String(error);

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      scrapedAt,
      count: 0,
      discounts: [],
      error: message,
    };
  }
}
