# fordel-aggregator

Scrapes membership discount pages once a month or on demand, aggregates matching stores across sources, and publishes a searchable overview to GitHub Pages.

## Included sources

- https://www.lofavor.no/home
- https://www.remember.no/reward/rabatt/
- https://trumfnetthandel.no/
- https://www.obos.no/medlem/medlemsfordeler?view=list
- Spenn (Norway): https://spenn-cdn.refunder.com/extension/v1/no/catalog.nb.json

Spenn uses the Norwegian catalog's stores, categories, and displayed earning rates (Spenn points, not cashback percentages). Links go to the public extension page because activation URLs require a personal `spennId`. Campaigns and direct brands without earning rates are not imported.

## Data model

Each scraped discount is normalized with:

- name
- source
- scrapedFrom
- link
- lastScraped
- categories
- description

Stores are grouped by normalized name, so multiple sources can appear together and categories are merged across sources.

## Local usage

```bash
npm ci
npm test
npm run build
```

The build generates `docs/index.html` and `docs/data.json`, which are deployed by `.github/workflows/scrape-and-deploy.yml`.

Scraper code is split by site under `src/scrapers/`, with `src/scraper.js` acting as the shared runner.
