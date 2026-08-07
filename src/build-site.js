import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateDiscounts } from './aggregate.js';
import { buildHtml } from './render.js';
import { scrapeSource } from './scraper.js';
import { SOURCES } from './sources.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(currentDir, '../docs');

async function main() {
  const generatedAt = new Date().toISOString();
  const sourceResults = await Promise.all(SOURCES.map((source) => scrapeSource(source)));
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
    if (source.error) {
      console.warn(`- ${source.name}: ${source.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
