import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDiscounts, normalizeStoreName } from '../src/aggregate.js';
import { applyFallbacks, applyFirstScraped } from '../src/build-site.js';
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
                shopUrl: '/reward/rabatt/komplett',
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
      link: 'https://www.remember.no/reward/rabatt/komplett',
      source: 'Remember Reward',
      sourceId: 'remember-reward',
      scrapedFrom: 'https://www.remember.no/reward/rabatt/',
      lastScraped: '2026-08-07T07:00:00.000Z',
    },
  ]);
});

test('scrapeSource uses LOfavør scraper, fetches individual pages and extracts descriptions', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const homeHtml = `
    <nav>
      <a class="nav-link" href="https://www.lofavor.no/forsikring/barneforsikring">Barneforsikring</a>
      <a class="nav-link" href="https://www.lofavor.no/juridisk/advokatforsikring">Advokatforsikring</a>
    </nav>`;

  const pageDescriptions = new Map([
    [
      'https://www.lofavor.no/forsikring/barneforsikring',
      '<meta name="description" content="Barneforsikring gir trygghet for deg og barnet.">',
    ],
    [
      'https://www.lofavor.no/juridisk/advokatforsikring',
      '<meta name="description" content="Med advokatforsikring har du tilgang til advokathjelp.">',
    ],
  ]);

  globalThis.fetch = async (url) => {
    const text = url === 'https://www.lofavor.no/home' ? homeHtml : (pageDescriptions.get(url) ?? '');
    return { ok: true, text: async () => text };
  };

  const result = await scrapeSource(
    {
      id: 'lofavor',
      name: 'LOfavør',
      url: 'https://www.lofavor.no/home',
      baseUrl: 'https://www.lofavor.no',
    },
    () => new Date('2026-08-07T09:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 2);
  assert.deepEqual(result.discounts[0], {
    name: 'Barneforsikring',
    description: 'Barneforsikring gir trygghet for deg og barnet.',
    categories: ['Forsikring'],
    link: 'https://www.lofavor.no/forsikring/barneforsikring',
    source: 'LOfavør',
    sourceId: 'lofavor',
    scrapedFrom: 'https://www.lofavor.no/home',
    lastScraped: '2026-08-07T09:00:00.000Z',
  });
  assert.deepEqual(result.discounts[1], {
    name: 'Advokatforsikring',
    description: 'Med advokatforsikring har du tilgang til advokathjelp.',
    categories: ['Juridisk'],
    link: 'https://www.lofavor.no/juridisk/advokatforsikring',
    source: 'LOfavør',
    sourceId: 'lofavor',
    scrapedFrom: 'https://www.lofavor.no/home',
    lastScraped: '2026-08-07T09:00:00.000Z',
  });
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

test('applyFirstScraped sets firstScraped from previous data when available', () => {
  const previousDiscount = {
    name: 'Komplett',
    link: 'https://example.com/komplett',
    source: 'Test Source',
    sourceId: 'test-source',
    lastScraped: '2026-08-06T07:00:00.000Z',
    firstScraped: '2026-08-05T07:00:00.000Z',
  };
  const previousDiscountsBySource = new Map([['test-source', [previousDiscount]]]);

  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      error: null,
      discounts: [
        {
          name: 'Komplett',
          link: 'https://example.com/komplett',
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
      ],
    },
  ];

  applyFirstScraped(sourceResults, previousDiscountsBySource);

  assert.equal(sourceResults[0].discounts[0].firstScraped, '2026-08-05T07:00:00.000Z');
});

test('applyFirstScraped preserves firstScraped for multiple discounts sharing the same link', () => {
  const sharedLink = 'https://example.com/cashback';
  const previousDiscounts = [
    {
      name: 'Nike',
      link: sharedLink,
      source: 'Test Source',
      sourceId: 'test-source',
      lastScraped: '2026-08-06T07:00:00.000Z',
      firstScraped: '2026-08-01T07:00:00.000Z',
    },
    {
      name: 'Adidas',
      link: sharedLink,
      source: 'Test Source',
      sourceId: 'test-source',
      lastScraped: '2026-08-06T07:00:00.000Z',
      firstScraped: '2026-08-02T07:00:00.000Z',
    },
  ];
  const previousDiscountsBySource = new Map([['test-source', previousDiscounts]]);

  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      error: null,
      discounts: [
        {
          name: 'Nike',
          link: sharedLink,
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
        {
          name: 'Adidas',
          link: sharedLink,
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
      ],
    },
  ];

  applyFirstScraped(sourceResults, previousDiscountsBySource);

  assert.equal(sourceResults[0].discounts[0].firstScraped, '2026-08-01T07:00:00.000Z');
  assert.equal(sourceResults[0].discounts[1].firstScraped, '2026-08-02T07:00:00.000Z');
});

test('applyFirstScraped uses lastScraped as firstScraped when no previous data', () => {
  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      error: null,
      discounts: [
        {
          name: 'Komplett',
          link: 'https://example.com/komplett',
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
      ],
    },
  ];

  applyFirstScraped(sourceResults, new Map());

  assert.equal(sourceResults[0].discounts[0].firstScraped, '2026-08-07T07:00:00.000Z');
});

test('aggregateDiscounts marks discount as isNew when firstScraped equals lastScraped', () => {
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
      firstScraped: '2026-08-07T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].discounts[0].isNew, true);
});

test('aggregateDiscounts does not mark discount as isNew when firstScraped differs', () => {
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
      firstScraped: '2026-08-01T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].discounts[0].isNew, false);
});

test('aggregateDiscounts includes firstScraped at store level', () => {
  const stores = aggregateDiscounts([
    {
      name: 'Tusenfryd',
      categories: [],
      link: 'https://example.com/1',
      source: 'Source A',
      sourceId: 'a',
      scrapedFrom: 'https://example.com/a',
      lastScraped: '2026-08-07T00:00:00.000Z',
      firstScraped: '2026-08-03T00:00:00.000Z',
    },
    {
      name: 'Tusenfryd',
      categories: [],
      link: 'https://example.com/2',
      source: 'Source B',
      sourceId: 'b',
      scrapedFrom: 'https://example.com/b',
      lastScraped: '2026-08-07T01:00:00.000Z',
      firstScraped: '2026-08-01T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].firstScraped, '2026-08-01T00:00:00.000Z');
});

test('buildHtml renders new badge and favorites button', () => {
  const html = buildHtml({ generatedAt: '2026-08-07T10:00:00.000Z' });
  assert.match(html, /pill-new/, 'new badge CSS class should exist in template');
  assert.match(html, /pill-stale/, 'stale badge CSS class should exist in template');
  assert.match(html, /fav-btn/, 'favorites button CSS class should exist in template');
  assert.match(html, /fordel-favorites/, 'localStorage key should be present');
  assert.match(html, /Kun favoritter/, 'favorites-only checkbox label should be present');
  assert.match(html, /Nyeste tilbud/, 'sort by newest option should be present');
  assert.match(html, /Eldste tilbud/, 'sort by oldest option should be present');
});

test('scrapeSource uses NITO extractor and stamps discounts', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const propsJson = JSON.stringify({
    memberBenefitList: [
      {
        category: { name: 'Rabatter', pictogram: '' },
        memberBenefitsDetails: [
          {
            contentLink: '/medlemskap-og-fordeler/medlemsfordeler/bilrabatt-mercedes-benz/',
            heading: 'Bilrabatt Mercedes-Benz',
            tags: ['Rabatter'],
            salesArguments: [],
            pricebomb: '',
            partnerName: 'Bertel O. Steen',
          },
          {
            contentLink: '/medlemskap-og-fordeler/medlemsfordeler/bilrabatt-opel/',
            heading: 'Bilrabatt Opel',
            tags: ['Rabatter'],
            salesArguments: [],
            pricebomb: '',
            partnerName: 'Bertel O. Steen',
          },
        ],
      },
    ],
  });

  const encodedProps = propsJson.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => `<div class="member-benefit-list"><div data-props="${encodedProps}"></div></div>`,
  });

  const result = await scrapeSource(
    {
      id: 'nito-medlemsfordeler',
      name: 'NITO Medlemsfordeler',
      url: 'https://www.nito.no/medlemskap-og-fordeler/medlemsfordeler/',
      baseUrl: 'https://www.nito.no',
    },
    () => new Date('2026-08-07T10:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 2);
  assert.deepEqual(result.discounts[0], {
    name: 'Bilrabatt Mercedes-Benz',
    description: null,
    categories: ['Rabatter'],
    link: 'https://www.nito.no/medlemskap-og-fordeler/medlemsfordeler/bilrabatt-mercedes-benz/',
    source: 'NITO Medlemsfordeler',
    sourceId: 'nito-medlemsfordeler',
    scrapedFrom: 'https://www.nito.no/medlemskap-og-fordeler/medlemsfordeler/',
    lastScraped: '2026-08-07T10:00:00.000Z',
  });
});

test('buildHtml includes click tracking localStorage key and most-clicked sort option', () => {
  const html = buildHtml({ generatedAt: '2026-08-07T10:00:00.000Z' });
  assert.match(html, /fordel-clicks/, 'click tracking localStorage key should be present');
  assert.match(html, /most-clicked/, 'most-clicked sort option value should be present');
  assert.match(html, /Mest klikket/, 'most-clicked sort option label should be present');
  assert.match(html, /recordClick/, 'recordClick function should be present');
});

test('normalizeStoreName strips known prefixes', () => {
  assert.equal(normalizeStoreName('Rabatt hos Scandic'), 'scandic');
  assert.equal(normalizeStoreName('Hotellrabatt Scandic'), 'scandic');
  assert.equal(normalizeStoreName('Rabatt på Scandic'), 'scandic');
});

test('normalizeStoreName strips domain TLD', () => {
  assert.equal(normalizeStoreName('Scandic.no'), 'scandic');
  assert.equal(normalizeStoreName('some.store.com'), 'some store');
});

test('aggregateDiscounts groups single-word discount with matching multi-word discounts', () => {
  const base = {
    link: 'https://x.com',
    source: 'A',
    sourceId: 'a',
    scrapedFrom: 'https://x.com',
    lastScraped: '2026-08-07T00:00:00.000Z',
  };
  const stores = aggregateDiscounts([
    { ...base, name: 'Scandic', description: '10% rabatt' },
    { ...base, name: 'Scandic Hotels', description: '15% rabatt' },
    { ...base, name: 'Hotellrabatt Scandic', description: '20% rabatt' },
  ]);

  assert.equal(stores.length, 1);
  assert.equal(stores[0].discountCount, 3);
});

test('aggregateDiscounts groups prefix-normalized discounts together', () => {
  const base = {
    link: 'https://x.com',
    source: 'A',
    sourceId: 'a',
    scrapedFrom: 'https://x.com',
    lastScraped: '2026-08-07T00:00:00.000Z',
  };
  const stores = aggregateDiscounts([
    { ...base, name: 'Rabatt hos Tusenfryd', description: '10% rabatt' },
    { ...base, name: 'Tusenfryd', description: '15% rabatt' },
  ]);

  assert.equal(stores.length, 1);
  assert.equal(stores[0].discountCount, 2);
});

test('scrapeSource uses Klarna scraper and paginates until exhausted', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const page0 = JSON.stringify({
    stores: [
      {
        displayName: 'Komplett',
        cashbackDiscount: {
          discountPercentage: 500,
          discountLabel: { prefix: '', body: '5%', suffix: 'cashback' },
          showUpToPrefix: false,
        },
        category: 'electronics',
      },
    ],
    totalHits: 2,
  });
  const page1 = JSON.stringify({
    stores: [
      {
        displayName: 'Elkjøp',
        cashbackDiscount: {
          discountPercentage: 300,
          discountLabel: { prefix: '', body: '3%', suffix: 'cashback' },
          showUpToPrefix: false,
        },
        category: null,
      },
    ],
    totalHits: 2,
  });

  let callCount = 0;
  globalThis.fetch = async (url) => {
    const text = url.includes('offset=0') && callCount++ === 0 ? page0 : page1;
    return { ok: true, text: async () => text };
  };

  const result = await scrapeSource(
    {
      id: 'klarna-cashback',
      name: 'Klarna Cashback',
      url: 'https://www.klarna.com/no/store/?type=CASHBACK',
      baseUrl: 'https://www.klarna.com',
    },
    () => new Date('2026-08-07T12:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 2);
  assert.deepEqual(result.discounts[0], {
    name: 'Komplett',
    description: '5% cashback',
    categories: ['Elektronikk'],
    link: 'https://www.klarna.com/no/store/?type=CASHBACK',
    source: 'Klarna Cashback',
    sourceId: 'klarna-cashback',
    scrapedFrom: 'https://www.klarna.com/no/store/?type=CASHBACK',
    cashbackPercentage: 500,
    lastScraped: '2026-08-07T12:00:00.000Z',
  });
  assert.deepEqual(result.discounts[1], {
    name: 'Elkjøp',
    description: '3% cashback',
    categories: [],
    link: 'https://www.klarna.com/no/store/?type=CASHBACK',
    source: 'Klarna Cashback',
    sourceId: 'klarna-cashback',
    scrapedFrom: 'https://www.klarna.com/no/store/?type=CASHBACK',
    cashbackPercentage: 300,
    lastScraped: '2026-08-07T12:00:00.000Z',
  });
});

test('scrapeSource uses Opptil prefix when showUpToPrefix is true and prefix is empty', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const page = JSON.stringify({
    stores: [
      {
        displayName: 'Zalando',
        cashbackDiscount: {
          discountPercentage: 800,
          discountLabel: { prefix: '', body: '8%', suffix: 'cashback' },
          showUpToPrefix: true,
        },
        category: 'fashion',
      },
    ],
    totalHits: 1,
  });

  globalThis.fetch = async () => ({ ok: true, text: async () => page });

  const result = await scrapeSource(
    {
      id: 'klarna-cashback',
      name: 'Klarna Cashback',
      url: 'https://www.klarna.com/no/store/?type=CASHBACK',
      baseUrl: 'https://www.klarna.com',
    },
    () => new Date('2026-08-07T12:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.deepEqual(result.discounts[0], {
    name: 'Zalando',
    description: 'Opptil 8% cashback',
    categories: ['Mote'],
    link: 'https://www.klarna.com/no/store/?type=CASHBACK',
    source: 'Klarna Cashback',
    sourceId: 'klarna-cashback',
    scrapedFrom: 'https://www.klarna.com/no/store/?type=CASHBACK',
    cashbackPercentage: 800,
    lastScraped: '2026-08-07T12:00:00.000Z',
  });
});

test('scrapeSource omits prefix when showUpToPrefix is false even if label.prefix has a value', { concurrency: false }, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const page = JSON.stringify({
    stores: [
      {
        displayName: 'Zalando',
        cashbackDiscount: {
          discountPercentage: 800,
          discountLabel: { prefix: 'Opptil', body: '8%', suffix: 'cashback' },
          showUpToPrefix: false,
        },
        category: 'fashion',
      },
    ],
    totalHits: 1,
  });

  globalThis.fetch = async () => ({ ok: true, text: async () => page });

  const result = await scrapeSource(
    {
      id: 'klarna-cashback',
      name: 'Klarna Cashback',
      url: 'https://www.klarna.com/no/store/?type=CASHBACK',
      baseUrl: 'https://www.klarna.com',
    },
    () => new Date('2026-08-07T12:00:00.000Z'),
  );

  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.deepEqual(result.discounts[0], {
    name: 'Zalando',
    description: '8% cashback',
    categories: ['Mote'],
    link: 'https://www.klarna.com/no/store/?type=CASHBACK',
    source: 'Klarna Cashback',
    sourceId: 'klarna-cashback',
    scrapedFrom: 'https://www.klarna.com/no/store/?type=CASHBACK',
    cashbackPercentage: 800,
    lastScraped: '2026-08-07T12:00:00.000Z',
  });
});

test('aggregateDiscounts marks discount as isUpdated when description has changed', () => {
  const stores = aggregateDiscounts([
    {
      name: 'Tusenfryd',
      description: '15 % rabatt',
      previousDescription: '10 % rabatt',
      categories: ['Fornøyelsespark'],
      link: 'https://example.com/1',
      source: 'Source A',
      sourceId: 'a',
      scrapedFrom: 'https://example.com/a',
      lastScraped: '2026-08-07T00:00:00.000Z',
      firstScraped: '2026-08-01T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].discounts[0].isNew, false);
  assert.equal(stores[0].discounts[0].isUpdated, true);
});

test('aggregateDiscounts does not mark discount as isUpdated when description is unchanged', () => {
  const stores = aggregateDiscounts([
    {
      name: 'Tusenfryd',
      description: '10 % rabatt',
      previousDescription: '10 % rabatt',
      categories: ['Fornøyelsespark'],
      link: 'https://example.com/1',
      source: 'Source A',
      sourceId: 'a',
      scrapedFrom: 'https://example.com/a',
      lastScraped: '2026-08-07T00:00:00.000Z',
      firstScraped: '2026-08-01T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].discounts[0].isUpdated, false);
});

test('aggregateDiscounts does not mark discount as isUpdated when it is new', () => {
  const stores = aggregateDiscounts([
    {
      name: 'Tusenfryd',
      description: '10 % rabatt',
      previousDescription: null,
      categories: ['Fornøyelsespark'],
      link: 'https://example.com/1',
      source: 'Source A',
      sourceId: 'a',
      scrapedFrom: 'https://example.com/a',
      lastScraped: '2026-08-07T00:00:00.000Z',
      firstScraped: '2026-08-07T00:00:00.000Z',
    },
  ]);

  assert.equal(stores[0].discounts[0].isNew, true);
  assert.equal(stores[0].discounts[0].isUpdated, false);
});

test('applyFirstScraped carries over previousDescription from previous data', () => {
  const previousDiscount = {
    name: 'Komplett',
    description: '4 % bonus',
    link: 'https://example.com/komplett',
    source: 'Test Source',
    sourceId: 'test-source',
    lastScraped: '2026-08-06T07:00:00.000Z',
    firstScraped: '2026-08-05T07:00:00.000Z',
  };
  const previousDiscountsBySource = new Map([['test-source', [previousDiscount]]]);

  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      error: null,
      discounts: [
        {
          name: 'Komplett',
          description: '5 % bonus',
          link: 'https://example.com/komplett',
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
      ],
    },
  ];

  applyFirstScraped(sourceResults, previousDiscountsBySource);

  assert.equal(sourceResults[0].discounts[0].previousDescription, '4 % bonus');
});

test('applyFirstScraped sets previousDescription to null when no previous data', () => {
  const sourceResults = [
    {
      id: 'test-source',
      name: 'Test Source',
      error: null,
      discounts: [
        {
          name: 'Komplett',
          description: '5 % bonus',
          link: 'https://example.com/komplett',
          source: 'Test Source',
          sourceId: 'test-source',
          lastScraped: '2026-08-07T07:00:00.000Z',
        },
      ],
    },
  ];

  applyFirstScraped(sourceResults, new Map());

  assert.equal(sourceResults[0].discounts[0].previousDescription, null);
});

test('buildHtml includes pill-updated CSS class', () => {
  const html = buildHtml({ generatedAt: '2026-08-07T10:00:00.000Z' });
  assert.match(html, /pill-updated/, 'updated badge CSS class should exist in template');
});
