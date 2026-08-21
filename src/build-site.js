import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateDiscounts } from './aggregate.js';
import { buildHtml } from './render.js';
import { scrapeSource } from './scraper.js';
import { SOURCES } from './sources.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(currentDir, '../docs');

async function loadPreviousData() {
  try {
    const raw = await readFile(path.join(docsDir, 'data.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function applyFallbacks(sourceResults, previousDiscountsBySource) {
  for (const result of sourceResults) {
    if (result.error) {
      const prev = previousDiscountsBySource.get(result.id) ?? [];
      if (prev.length > 0) {
        result.discounts = prev.map((discount) => ({ ...discount, stale: true }));
        result.count = result.discounts.length;
        console.warn(`- ${result.name}: using ${result.count} cached discounts due to error: ${result.error}`);
      }
    }
  }
}

export function applyFirstScraped(sourceResults, previousDiscountsBySource) {
  for (const result of sourceResults) {
    if (result.error) {
      continue;
    }
    const prev = previousDiscountsBySource.get(result.id) ?? [];
    const prevKey = (discount) => `${discount.name}\0${discount.link}`;
    const prevByKey = new Map(prev.map((discount) => [prevKey(discount), discount]));
    result.discounts = result.discounts.map((discount) => {
      const previous = prevByKey.get(prevKey(discount));
      const firstScraped = previous?.firstScraped ?? previous?.lastScraped ?? discount.lastScraped;
      const previousDescription = previous?.description ?? null;
      return { ...discount, firstScraped, previousDescription };
    });
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const previousData = await loadPreviousData();
  const previousDiscountsBySource = new Map();
  for (const discount of previousData?.discounts ?? []) {
    if (!previousDiscountsBySource.has(discount.sourceId)) {
      previousDiscountsBySource.set(discount.sourceId, []);
    }
    previousDiscountsBySource.get(discount.sourceId).push(discount);
  }

  const sourceResults = await Promise.all(SOURCES.map((source) => scrapeSource(source)));

  applyFirstScraped(sourceResults, previousDiscountsBySource);
  applyFallbacks(sourceResults, previousDiscountsBySource);

  const discounts = sourceResults.flatMap((source) => source.discounts);
  const stores = aggregateDiscounts(discounts);

  const data = {
    generatedAt,
    discounts,
    stores,
    sources: sourceResults.map(({ discounts: sourceDiscounts, ...source }) => source),
  };

  await mkdir(docsDir, { recursive: true });
  await writeFile(path.join(docsDir, 'data.json'), JSON.stringify(data, null, 2) + '\n');
  await writeFile(path.join(docsDir, 'index.html'), buildHtml({ generatedAt }));
  await writeFile(path.join(docsDir, '.nojekyll'), '');

  const successfulSources = sourceResults.filter((source) => !source.error).length;
  console.log(`Built ${stores.length} stores from ${discounts.length} discounts across ${successfulSources}/${sourceResults.length} successful sources.`);

  for (const source of sourceResults) {
    if (source.error && source.count === 0) {
      console.warn(`- ${source.name}: ${source.error}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
