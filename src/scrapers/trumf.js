/**
 * Trumf Netthandel: fetch each category page and extract store cards which
 * carry the store name, cashback percentage and URL as data attributes.
 */
export async function scrapeTrumfDiscounts(fetch, source) {
  const html = await fetch(source.url);
  const catSlugs = [...new Set([...html.matchAll(/href="(\/kategori\/[^"]+)"/g)].map((match) => match[1]))].filter(
    (slug) => slug !== '/kategori',
  );

  const results = [];
  const seen = new Set();
  const concurrency = 4;

  for (let index = 0; index < catSlugs.length; index += concurrency) {
    const batch = catSlugs.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async (slug) => {
        const catHtml = await fetch(`${source.baseUrl}${slug}`).catch((error) => {
          console.warn(`Failed to fetch Trumf category ${slug}: ${error.message}`);
          return '';
        });
        const catName = slug.replace('/kategori/', '');
        const display = catName.charAt(0).toUpperCase() + catName.slice(1);

        for (const tagMatch of catHtml.matchAll(/<a\b([^>]*href="\/cashback\/[^"]*"[^>]*)>/g)) {
          const tag = tagMatch[1];
          const hrefMatch = tag.match(/href="(\/cashback\/[^"]+)"/);
          const nameMatch = tag.match(/data-name="([^"]+)"/);
          const percentageMatch = tag.match(/data-percentage="([^"]+)"/);
          if (!hrefMatch || !nameMatch) continue;
          const [, href] = hrefMatch;
          const [, name] = nameMatch;
          const percentage = percentageMatch ? percentageMatch[1] : '';
          const key = `${name}::${href}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            name,
            description: percentage ? `Opptil ${percentage} Trumf-bonus` : null,
            categories: [display],
            link: `${source.baseUrl}${href}`,
            source: source.name,
            sourceId: source.id,
            scrapedFrom: source.url,
          });
        }
      }),
    );
  }

  return results;
}
