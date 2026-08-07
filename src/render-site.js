import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './render.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(currentDir, '../docs');

async function main() {
  const raw = await readFile(path.join(docsDir, 'data.json'), 'utf8');
  const data = JSON.parse(raw);

  await writeFile(path.join(docsDir, 'index.html'), buildHtml({ generatedAt: data.generatedAt }));
  await writeFile(path.join(docsDir, '.nojekyll'), '');

  console.log('Rendered site from existing data.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
