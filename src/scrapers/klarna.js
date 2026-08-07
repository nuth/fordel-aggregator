const KLARNA_API_BASE =
  'https://www.klarna.com/no/api/store-edge-rest/public/stores/directory/search/NO?sort=RANK&cashback=true&categories=&klarnaIntegrated=false&applePay=false&googlePay=false&inStore=false&q=&otcEnabled=false';

const PAGE_SIZE = 100;

const CATEGORY_LABELS = {
  health_beauty: 'Helse og skjønnhet',
  fashion: 'Mote',
  electronics: 'Elektronikk',
  home_more: 'Hjem og mer',
  sports: 'Sport',
  conscious: 'Bærekraft',
  marketplaces: 'Markedsplasser',
};

/**
 * Fetch a Klarna API URL and return the response body as text.
 * Uses a browser-like user-agent as required by the Klarna API.
 */
export async function fetchKlarnaJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      accept: 'application/json',
      'accept-language': 'nb-NO,nb;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function buildDescription(cashbackDiscount) {
  if (!cashbackDiscount) return null;
  const label = cashbackDiscount.discountLabel;
  if (!label) return null;
  const prefix =
    cashbackDiscount.showUpToPrefix && !label.prefix ? 'Opptil' : label.prefix;
  const parts = [prefix, label.body, label.suffix].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function mapStore(store, source) {
  const categorySlug = store.category ?? null;
  const categories = categorySlug ? [CATEGORY_LABELS[categorySlug] ?? categorySlug] : [];

  return {
    name: store.displayName ?? store.name,
    description: buildDescription(store.cashbackDiscount) ?? null,
    categories,
    link: source.url,
    source: source.name,
    sourceId: source.id,
    scrapedFrom: source.url,
  };
}

/**
 * Klarna: fetch all cashback stores from the Klarna directory API using
 * offset-based pagination and map each store to a discount entry.
 */
export async function scrapeKlarnaDiscounts(fetchJson, source) {
  const results = [];
  let offset = 0;

  for (;;) {
    const url = `${KLARNA_API_BASE}&offset=${offset}&size=${PAGE_SIZE}`;
    const json = await fetchJson(url);
    const page = JSON.parse(json);
    const stores = page.stores ?? [];
    if (stores.length === 0) break;

    for (const store of stores) {
      results.push(mapStore(store, source));
    }

    const total = page.totalHits ?? null;
    offset += stores.length;
    if (total !== null && offset >= total) break;
    else if (total === null && stores.length < PAGE_SIZE) break;
  }

  return results;
}
