import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDiscounts } from '../src/aggregate.js';
import { applyFallbacks } from '../src/build-site.js';
import { buildHtml } from '../src/render.js';
import { extractDiscountsFromHtml, scrapeSource } from '../src/scraper.js';

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

test('scrapeSource uses Remember Reward extractor and stamps discounts', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => `
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            stores: [
              {
                id: 'butikk-1',
                enabled: true,
                name: 'Komplett',
                description: 'Opptil 4 % bonus',
                affiliateUrl: 'https://remember.example/komplett',
              },
            ],
            categories: [
              {
                title: 'Elektronikk',
                shops: [{ id: 'butikk-1' }],
              },
            ],
          },
        },
      })}</script>`,
  });

  const result = await scrapeSource(
    {
      id: 'remember-reward',
      name: 'Remember Reward',
      url: 'https://www.remember.no/reward/rabatt/',
      baseUrl: 'https://www.remember.no',
    },
    () => new Date('2026-08-07T07:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.deepEqual(result.discounts, [
    {
      name: 'Komplett',
      description: 'Opptil 4 % bonus',
      categories: ['Elektronikk'],
      link: 'https://remember.example/komplett',
      source: 'Remember Reward',
      sourceId: 'remember-reward',
      scrapedFrom: 'https://www.remember.no/reward/rabatt/',
      lastScraped: '2026-08-07T07:00:00.000Z',
    },
  ]);
});

test('scrapeSource uses OBOS extractor and stamps discounts', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const payload =
    `${'x'.repeat(50_001)}` +
    '{"_type":"member_memberBenefit","categories":[{"name":"Reise"}],"company":{"ingress":"10 % rabatt","title":"Color Line"},"slug":{"current":"color-line"}}';

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`,
  });

  const result = await scrapeSource(
    {
      id: 'obos-medlemsfordeler',
      name: 'OBOS Medlemsfordeler',
      url: 'https://www.obos.no/medlem/medlemsfordeler?view=list',
      baseUrl: 'https://www.obos.no',
    },
    () => new Date('2026-08-07T08:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.deepEqual(result.discounts, [
    {
      name: 'Color Line',
      description: '10 % rabatt',
      categories: ['Reise'],
      link: 'https://www.obos.no/medlem/medlemsfordeler/color-line',
      source: 'OBOS Medlemsfordeler',
      sourceId: 'obos-medlemsfordeler',
      scrapedFrom: 'https://www.obos.no/medlem/medlemsfordeler?view=list',
      lastScraped: '2026-08-07T08:00:00.000Z',
    },
  ]);
});

test('scrapeSource batches Trumf category fetches and stamps discounts', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const categoryPages = new Map(
    Array.from({ length: 9 }, (_, index) => {
      const slug = `/kategori/kategori-${index + 1}`;
      return [
        `https://trumfnetthandel.no${slug}`,
        `<a href="/cashback/butikk-${index + 1}" data-name="Butikk ${index + 1}" data-percentage="${index + 1} %"></a>`,
      ];
    }),
  );

  let activeCategoryFetches = 0;
  let maxConcurrentCategoryFetches = 0;

  globalThis.fetch = async (url) => {
    if (url === 'https://trumfnetthandel.no/') {
      return {
        ok: true,
        text: async () => [...categoryPages.keys()].map((pageUrl) => `<a href="${new URL(pageUrl).pathname}"></a>`).join(''),
      };
    }

    if (categoryPages.has(url)) {
      activeCategoryFetches += 1;
      maxConcurrentCategoryFetches = Math.max(maxConcurrentCategoryFetches, activeCategoryFetches);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCategoryFetches -= 1;
      return {
        ok: true,
        text: async () => categoryPages.get(url),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await scrapeSource(
    {
      id: 'trumf-netthandel',
      name: 'Trumf Netthandel',
      url: 'https://trumfnetthandel.no/',
      baseUrl: 'https://trumfnetthandel.no',
    },
    () => new Date('2026-08-07T09:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 9);
  assert.ok(maxConcurrentCategoryFetches <= 4);
  assert.deepEqual(result.discounts[0], {
    name: 'Butikk 1',
    description: 'Opptil 1 % Trumf-bonus',
    categories: ['Kategori-1'],
    link: 'https://trumfnetthandel.no/cashback/butikk-1',
    source: 'Trumf Netthandel',
    sourceId: 'trumf-netthandel',
    scrapedFrom: 'https://trumfnetthandel.no/',
    lastScraped: '2026-08-07T09:00:00.000Z',
  });
});

test('buildHtml adds noopener to external links', () => {
  const html = buildHtml({ generatedAt: '2026-08-07T10:00:00.000Z' });
  assert.match(html, /rel = 'noopener noreferrer'/);
});

test('applyFallbacks uses previous discounts with stale flag when source fails', () => {
  const previousDiscount = {
    name: 'Komplett',
    description: 'Opptil 4 % bonus',
    categories: ['Elektronikk'],
    link: 'https://example.com/komplett',
    source: 'Test Source',
    sourceId: 'test-source',
    scrapedFrom: 'https://example.com/',
    lastScraped: '2026-08-06T07:00:00.000Z',
  };
  const previousDiscountsBySource = new Map([['test-source', [previousDiscount]]]);

  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      url: 'https://example.com/',
      scrapedAt: '2026-08-07T07:00:00.000Z',
      count: 0,
      discounts: [],
      error: 'HTTP 503 Service Unavailable',
    },
  ];

  applyFallbacks(sourceResults, previousDiscountsBySource);

  assert.equal(sourceResults[0].count, 1);
  assert.equal(sourceResults[0].discounts[0].stale, true);
  assert.equal(sourceResults[0].discounts[0].name, 'Komplett');
  assert.equal(sourceResults[0].error, 'HTTP 503 Service Unavailable');
});

test('applyFallbacks leaves result unchanged when source fails with no previous data', () => {
  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      url: 'https://example.com/',
      scrapedAt: '2026-08-07T07:00:00.000Z',
      count: 0,
      discounts: [],
      error: 'HTTP 503 Service Unavailable',
    },
  ];

  applyFallbacks(sourceResults, new Map());

  assert.equal(sourceResults[0].count, 0);
  assert.deepEqual(sourceResults[0].discounts, []);
});

test('applyFallbacks does not modify successful source results', () => {
  const discount = {
    name: 'Komplett',
    description: 'Opptil 4 % bonus',
    categories: ['Elektronikk'],
    link: 'https://example.com/komplett',
    source: 'Test Source',
    sourceId: 'test-source',
    scrapedFrom: 'https://example.com/',
    lastScraped: '2026-08-07T07:00:00.000Z',
  };
  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      url: 'https://example.com/',
      scrapedAt: '2026-08-07T07:00:00.000Z',
      count: 1,
      discounts: [discount],
      error: null,
    },
  ];
  const oldDiscount = { ...discount, name: 'Old Komplett', lastScraped: '2026-08-06T07:00:00.000Z' };
  const previousDiscountsBySource = new Map([['test-source', [oldDiscount]]]);

  applyFallbacks(sourceResults, previousDiscountsBySource);

  assert.equal(sourceResults[0].count, 1);
  assert.equal(sourceResults[0].discounts[0].name, 'Komplett');
  assert.equal(sourceResults[0].discounts[0].stale, undefined);
});

test('buildHtml renders stale badge for stale discounts', () => {
  const html = buildHtml({ generatedAt: '2026-08-07T10:00:00.000Z' });
  assert.match(html, /pill-stale/);
  assert.match(html, /Utdatert/);
});
