import test from 'node:test';
import assert from 'node:assert/strict';
import { scrapeSource } from '../src/scraper.js';
import { scrapeSpennDiscounts } from '../src/scrapers/spenn.js';
import { SOURCES } from '../src/sources.js';

const source = SOURCES.find((entry) => entry.id === 'spenn');

function catalog(stores) {
  return JSON.stringify({ market: 'NO', locale: 'nb', stores });
}

test('scrapeSource fetches Spenn Norwegian catalog and stamps point offers', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      text: async () => catalog([
        {
          name: 'Komplett',
          description: 'Elektronikk og dingser.',
          spenn: 'Opp til 1,4 Spenn per 10 kr',
          rate: { value: 1.4, unit: 'per 10 kr', fixed: false, up_to: true },
          category: 'Elektronikk og teknologi',
          activation_url: 'https://spenn.refunder.com/click?spennId={spennId}',
        },
        {
          name: 'Bakeren og Kokken', spenn: '1,9 Spenn per 10 kr', category: 'Hjem & Hage',
          rate: { value: 1.9, unit: 'per 10 kr', fixed: false, up_to: false },
        },
      ]),
    };
  };

  const result = await scrapeSource(source, () => new Date('2026-11-17T12:00:00.000Z'));

  assert.deepEqual(urls, ['https://spenn-cdn.refunder.com/extension/v1/no/catalog.nb.json']);
  assert.equal(result.error, null);
  assert.equal(result.count, 2);
  assert.deepEqual(result.discounts[0], {
    name: 'Komplett',
    description: 'Opptil ca. 1,4 % i Spenn (Opp til 1,4 Spenn per 10 kr; 10 Spenn ≈ 1 kr)',
    categories: ['Elektronikk og teknologi'],
    link: 'https://spenn.refunder.com/no/extension',
    source: 'Spenn',
    sourceId: 'spenn',
    scrapedFrom: source.url,
    lastScraped: '2026-11-17T12:00:00.000Z',
  });
  assert.equal(result.discounts[1].description, 'Ca. 1,9 % i Spenn (1,9 Spenn per 10 kr; 10 Spenn ≈ 1 kr)');
  assert.equal(result.discounts[0].cashbackPercentage, undefined);
});

test('Spenn handles missing optional fields and skips unnamed stores', async () => {
  const discounts = await scrapeSpennDiscounts(async () => catalog([
    null,
    { name: ' ' },
    { name: '  Butikk  A ', description: ' Informasjon  om butikken ' },
    { name: 'Butikk B' },
  ]), source);

  assert.equal(discounts.length, 2);
  assert.equal(discounts[0].name, 'Butikk A');
  assert.equal(discounts[0].description, 'Informasjon om butikken');
  assert.deepEqual(discounts[0].categories, []);
  assert.equal(discounts[1].description, null);
});

test('Spenn leaves fixed, unsupported, or invalid rates unconverted', async () => {
  for (const rate of [
    { value: 100, unit: 'per 10 kr', fixed: true },
    { value: 100, unit: 'per kjøp', fixed: false },
    { value: '1.4', unit: 'per 10 kr', fixed: false },
    { value: -1, unit: 'per 10 kr', fixed: false },
    { value: null, unit: 'per 10 kr', fixed: false },
  ]) {
    const discounts = await scrapeSpennDiscounts(async () => catalog([
      { name: 'Butikk', spenn: 'Original opptjening', rate },
    ]), source);
    assert.equal(discounts[0].description, 'Original opptjening');
  }
});

test('Spenn converts zero rates and rates without display text', async () => {
  const discounts = await scrapeSpennDiscounts(async () => catalog([
    { name: 'Butikk', rate: { value: 0, unit: 'per 10 kr', fixed: false } },
  ]), source);
  assert.equal(discounts[0].description, 'Ca. 0 % i Spenn (10 Spenn ≈ 1 kr)');
});

test('Spenn rejects malformed catalogs and other markets or locales', async () => {
  for (const payload of [null, {}, { market: 'NO', locale: 'nb', stores: {} },
    { market: 'SE', locale: 'nb', stores: [] }, { market: 'NO', locale: 'en', stores: [] }]) {
    await assert.rejects(
      scrapeSpennDiscounts(async () => JSON.stringify(payload), source),
      /Invalid Spenn Norwegian catalog/,
    );
  }
  await assert.rejects(scrapeSpennDiscounts(async () => 'not JSON', source), SyntaxError);
});

test('scrapeSource reports Spenn HTTP failures', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });

  const result = await scrapeSource(source);
  assert.equal(result.error, 'HTTP 503 Service Unavailable');
  assert.equal(result.count, 0);
  assert.deepEqual(result.discounts, []);
});
