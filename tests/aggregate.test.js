import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDiscounts } from '../src/aggregate.js';
import { extractDiscountsFromHtml } from '../src/scraper.js';

const source = {
  id: 'test',
  name: 'Test Source',
  url: 'https://example.com/discounts',
  baseUrl: 'https://example.com',
};

test('aggregateDiscounts merges categories and discounts across sources', () => {
  const stores = aggregateDiscounts([
    {
      name: 'Tusenfryd',
      description: '10 % rabatt',
      categories: ['Fornøyelsespark'],
      link: 'https://example.com/1',
      source: 'Source A',
      sourceId: 'a',
      scrapedFrom: 'https://example.com/a',
      lastScraped: '2026-08-07T00:00:00.000Z',
    },
    {
      name: 'Tusenfryd',
      description: 'Sommerfordel',
      categories: ['Barn og familie'],
      link: 'https://example.com/2',
      source: 'Source B',
      sourceId: 'b',
      scrapedFrom: 'https://example.com/b',
      lastScraped: '2026-08-07T01:00:00.000Z',
    },
  ]);

  assert.equal(stores.length, 1);
  assert.equal(stores[0].name, 'Tusenfryd');
  assert.deepEqual(stores[0].categories, ['Barn og familie', 'Fornøyelsespark']);
  assert.equal(stores[0].discountCount, 2);
  assert.equal(stores[0].lastScraped, '2026-08-07T01:00:00.000Z');
});

test('extractDiscountsFromHtml reads structured discount data', () => {
  const html = `
    <html>
      <body>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "itemListElement": [
              {
                "name": "Tusenfryd",
                "url": "/fordeler/tusenfryd",
                "description": "15 % rabatt på billetter",
                "category": ["Fornøyelsespark", "Barn og familie"]
              }
            ]
          }
        </script>
      </body>
    </html>`;

  const discounts = extractDiscountsFromHtml(html, source);
  assert.deepEqual(discounts, [
    {
      name: 'Tusenfryd',
      description: '15 % rabatt på billetter',
      categories: ['Fornøyelsespark', 'Barn og familie'],
      link: 'https://example.com/fordeler/tusenfryd',
      source: 'Test Source',
      sourceId: 'test',
      scrapedFrom: 'https://example.com/discounts',
    },
  ]);
});
