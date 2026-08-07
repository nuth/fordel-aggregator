const GRAPHQL_URL =
  'https://app-api.klarna.com/api/deals_directory_bff/public/graphql';

const CASHBACK_QUERY = `query getCashbackLandingPage($market: Market!) {
  cashbackLandingPage: getCashbackLandingPage(market: $market) {
    sections {
      title
      deals {
        merchantName
        cashbackAmount
        dealUrl
        isUpTo
        storeKrn
      }
    }
  }
}`;

async function fetchGraphQLSections() {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'fordel-aggregator/1.0 (+https://github.com/nuth/fordel-aggregator)',
    },
    body: JSON.stringify({
      operationName: 'getCashbackLandingPage',
      query: CASHBACK_QUERY,
      variables: { market: 'NO' },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json?.data?.cashbackLandingPage?.sections ?? [];
}

function formatCashback(cashbackAmount, isUpTo) {
  const pct = cashbackAmount / 100;
  const pctStr = Number.isInteger(pct) ? `${pct}` : `${pct}`.replace('.', ',');
  return isUpTo ? `Opptil ${pctStr} % cashback` : `${pctStr} % cashback`;
}

function parseGraphQLSections(sections, source) {
  const seen = new Set();
  const results = [];

  for (const section of sections) {
    const category = section.title ? section.title : null;
    for (const deal of section.deals ?? []) {
      if (!deal.merchantName) continue;
      const key = deal.merchantName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        name: deal.merchantName,
        description: typeof deal.cashbackAmount === 'number'
          ? formatCashback(deal.cashbackAmount, deal.isUpTo)
          : null,
        categories: category ? [category] : [],
        link: deal.dealUrl || source.url,
        source: source.name,
        sourceId: source.id,
        scrapedFrom: source.url,
      });
    }
  }

  return results;
}

function extractStoresFromHtml(html) {
  const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi);
  for (const match of scripts) {
    const content = match[1];
    if (!content.includes('storeDirectUrl')) continue;
    try {
      const start = content.indexOf('{');
      if (start < 0) continue;
      const end = content.lastIndexOf('}');
      if (end <= start) continue;
      const data = JSON.parse(content.slice(start, end + 1));
      const queries = data?.__DEHYDRATED_QUERY_STATE__?.queries;
      if (!Array.isArray(queries)) continue;
      for (const q of queries) {
        const pages = q?.state?.data?.pages;
        if (!Array.isArray(pages)) continue;
        for (const page of pages) {
          if (Array.isArray(page.stores) && page.stores.length > 0) {
            return page.stores;
          }
        }
      }
    } catch {
      // Not parseable JSON, skip
    }
  }
  return [];
}

function parseHtmlStores(stores, source) {
  const results = [];
  for (const store of stores) {
    if (!store.displayName) continue;
    const label = store.cashbackDiscount?.discountLabel;
    const body = label?.body ?? '';
    if (!body) continue;
    const cleanBody = body.replace(/\s*%\s*$/, '');
    const showUpTo = store.cashbackDiscount?.showUpToPrefix === true;
    const description = showUpTo ? `Opptil ${cleanBody} % cashback` : `${cleanBody} % cashback`;
    results.push({
      name: store.displayName,
      description,
      categories: [],
      link: store.storeDirectUrl || source.url,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }
  return results;
}

/**
 * Klarna: fetch cashback store discounts from the public GraphQL API, with a
 * fallback to parsing the __DEHYDRATED_QUERY_STATE__ blob embedded in the page.
 */
export async function scrapeKlarnaDiscounts(fetchHtml, source) {
  let sections = [];
  try {
    sections = await fetchGraphQLSections();
  } catch (error) {
    console.warn(`Klarna GraphQL API failed: ${error.message}`);
  }

  if (sections.length > 0) {
    return parseGraphQLSections(sections, source);
  }

  const html = await fetchHtml(source.url);
  const stores = extractStoresFromHtml(html);
  return parseHtmlStores(stores, source);
}
