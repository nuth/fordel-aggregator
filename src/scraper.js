const STOP_WORDS = new Set([
  'hjem',
  'home',
  'logg inn',
  'login',
  'meny',
  'menu',
  'kontakt',
  'kontakt oss',
  'om oss',
  'min side',
  'bli medlem',
  'medlem',
  'rabatt',
  'rabatter',
  'fordeler',
  'reward',
  'netthandel',
  'se alle',
  'les mer',
  'mer info',
  'tilbake',
]);

const IRRELEVANT_TYPES = new Set([
  'WebSite',
  'WebPage',
  'Organization',
  'BreadcrumbList',
  'ListItem',
  'SiteNavigationElement',
]);

function normalizeWhitespace(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '));
}

function asAbsoluteUrl(baseUrl, value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = normalizeWhitespace(stripTags(value));
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function collectCategoryValues(value, output = new Set()) {
  if (!value) {
    return output;
  }

  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(stripTags(value));
    if (normalized) {
      output.add(normalized);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCategoryValues(entry, output);
    }
    return output;
  }

  if (typeof value === 'object') {
    collectCategoryValues(value.name ?? value.title ?? value.label, output);
  }

  return output;
}

function getCategories(candidate) {
  return [...collectCategoryValues(candidate.category)]
    .concat([...collectCategoryValues(candidate.categories)])
    .concat([...collectCategoryValues(candidate.genre)])
    .concat([...collectCategoryValues(candidate.tags)])
    .filter(Boolean);
}

function candidateName(candidate) {
  return pickString(
    candidate.name,
    candidate.title,
    candidate.headline,
    candidate.storeName,
    candidate.shopName,
    candidate.merchantName,
    candidate.partnerName,
    candidate.brand?.name,
    candidate.vendor?.name,
    candidate.provider?.name,
    candidate.seller?.name,
    candidate.advertiserName,
  );
}

function candidateDescription(candidate) {
  return pickString(
    candidate.description,
    candidate.summary,
    candidate.teaser,
    candidate.shortDescription,
    candidate.offerText,
  );
}

function candidateUrl(candidate, baseUrl) {
  return asAbsoluteUrl(
    baseUrl,
    pickString(candidate.url, candidate['@id'], candidate.href, candidate.path),
  );
}

function isCandidateObject(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }

  const candidateTypes = [candidate['@type']].flat().filter(Boolean);
  if (candidateTypes.some((type) => IRRELEVANT_TYPES.has(type))) {
    return false;
  }

  const name = candidateName(candidate);
  if (!name || STOP_WORDS.has(name.toLowerCase())) {
    return false;
  }

  return Boolean(candidateUrl(candidate, 'https://example.invalid') || candidateDescription(candidate) || getCategories(candidate).length);
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') {
    return;
  }

  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit);
    }
    return;
  }

  for (const nested of Object.values(value)) {
    walk(nested, visit);
  }
}

function extractJsonScriptContents(html) {
  const contents = [];
  const pattern = /<script[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const body = normalizeWhitespace(match[1]);
    if (body) {
      contents.push(body);
    }
  }

  return contents;
}

function parseJsonBlock(block) {
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

function uniqueByKey(items, keySelector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keySelector(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractFromStructuredData(html, source) {
  const results = [];

  for (const block of extractJsonScriptContents(html)) {
    const parsed = parseJsonBlock(block);
    if (!parsed) {
      continue;
    }

    walk(parsed, (candidate) => {
      if (!isCandidateObject(candidate)) {
        return;
      }

      const name = candidateName(candidate);
      const url = candidateUrl(candidate, source.baseUrl);
      if (!name || !url) {
        return;
      }

      results.push({
        name,
        description: candidateDescription(candidate),
        categories: [...new Set(getCategories(candidate))],
        link: url,
        source: source.name,
        sourceId: source.id,
        scrapedFrom: source.url,
      });
    });
  }

  return uniqueByKey(results, (item) => `${item.name}::${item.link}`);
}

function isLikelyStoreAnchor(text, href) {
  if (!text || !href) {
    return false;
  }

  const normalizedText = text.toLowerCase();
  if (STOP_WORDS.has(normalizedText)) {
    return false;
  }

  if (normalizedText.length < 2 || normalizedText.length > 80) {
    return false;
  }

  if (/^(#|javascript:|mailto:|tel:)/i.test(href)) {
    return false;
  }

  if (/\b(logg-inn|login|bli-medlem|medlemsskap|kontakt|privacy|personvern)\b/i.test(href)) {
    return false;
  }

  return true;
}

function extractFromAnchors(html, source) {
  const anchors = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const text = normalizeWhitespace(stripTags(match[2]));
    if (!isLikelyStoreAnchor(text, href)) {
      continue;
    }

    const link = asAbsoluteUrl(source.baseUrl, href);
    if (!link) {
      continue;
    }

    const linkUrl = new URL(link);
    const baseUrl = new URL(source.baseUrl);
    if (linkUrl.hostname !== baseUrl.hostname) {
      continue;
    }

    anchors.push({
      name: text,
      description: null,
      categories: [],
      link,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }

  return uniqueByKey(anchors, (item) => `${item.name}::${item.link}`);
}

export function extractDiscountsFromHtml(html, source) {
  const structured = extractFromStructuredData(html, source);
  return structured.length > 0 ? structured : extractFromAnchors(html, source);
}

// ─── Site-specific extractors ────────────────────────────────────────────────

/**
 * LOfavør: extract benefits by filtering nav anchors to known benefit-category
 * URL prefixes and inferring the category from the URL path.
 */
function extractLofavorDiscounts(html, source) {
  const CATEGORY_PREFIXES = [
    ['/forsikring/', 'Forsikring'],
    ['/juridisk/', 'Juridisk'],
    ['/ferie-og-opplevelser/', 'Ferie og opplevelser'],
    ['/ferie-og-fritid/', 'Ferie og fritid'],
    ['/hus-og-hjem/', 'Hus og hjem'],
    ['/bank/', 'Bank'],
  ];

  const seen = new Set();
  const results = [];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, inner] = match;

    let pathname;
    try {
      pathname = new URL(href, source.baseUrl).pathname;
    } catch {
      continue;
    }

    let category = null;
    for (const [prefix, cat] of CATEGORY_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        category = cat;
        break;
      }
    }
    if (!category) continue;

    const name = normalizeWhitespace(stripTags(inner));
    if (!name || STOP_WORDS.has(name.toLowerCase()) || name.length > 80) continue;

    const link = asAbsoluteUrl(source.baseUrl, href);
    if (!link) continue;

    const key = `${name}::${pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name,
      description: null,
      categories: [category],
      link,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }

  return results;
}

/**
 * Remember Reward: parse the embedded __NEXT_DATA__ JSON which contains a
 * complete store list with descriptions, affiliate URLs, and category mappings.
 */
function extractRememberRewardDiscounts(html, source) {
  const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return [];

  let data;
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch {
    return [];
  }

  const pp = data?.props?.pageProps;
  if (!pp?.stores) return [];

  // Build store-id → category-name[] map from categories[].shops
  const storeCats = new Map();
  for (const cat of pp.categories ?? []) {
    const catName = cat.title || cat.name || '';
    for (const shop of cat.shops ?? []) {
      if (!storeCats.has(shop.id)) storeCats.set(shop.id, []);
      storeCats.get(shop.id).push(catName);
    }
  }

  return pp.stores
    .filter((s) => s.enabled && s.name)
    .map((s) => ({
      name: normalizeWhitespace(s.name),
      description: s.description ? normalizeWhitespace(s.description) : null,
      categories: storeCats.get(s.id) ?? [],
      link: s.affiliateUrl || asAbsoluteUrl(source.baseUrl, s.shopUrl) || source.url,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    }));
}

/**
 * Trumf Netthandel: fetch each category page and extract store cards which
 * carry the store name, cashback percentage and URL as data attributes.
 */
async function scrapeTrumfDiscounts(fetch, source) {
  const html = await fetch(source.url);
  const catSlugs = [...new Set([...html.matchAll(/href="(\/kategori\/[^"]+)"/g)].map((m) => m[1]))].filter(
    (slug) => slug !== '/kategori',
  );

  const results = [];
  const seen = new Set();
  const concurrency = 4;

  for (let index = 0; index < catSlugs.length; index += concurrency) {
    const batch = catSlugs.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async (slug) => {
        const catHtml = await fetch(`${source.baseUrl}${slug}`).catch(() => '');
        const catName = slug.replace('/kategori/', '');
        const display = catName.charAt(0).toUpperCase() + catName.slice(1);

        for (const tagMatch of catHtml.matchAll(/<a\b([^>]*href="\/cashback\/[^"]*"[^>]*)>/g)) {
          const tag = tagMatch[1];
          const hrefM = tag.match(/href="(\/cashback\/[^"]+)"/);
          const nameM = tag.match(/data-name="([^"]+)"/);
          const pctM = tag.match(/data-percentage="([^"]+)"/);
          if (!hrefM || !nameM) continue;
          const [, href] = hrefM;
          const [, name] = nameM;
          const pct = pctM ? pctM[1] : '';
          const key = `${name}::${href}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            name,
            description: pct ? `Opptil ${pct} Trumf-bonus` : null,
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

/**
 * OBOS Medlemsfordeler: the page uses Next.js App Router (RSC wire format).
 * The full benefit list including names, slugs, categories and ingress text is
 * embedded in the largest __next_f.push block as a JSON-encoded string.
 */
function extractObosDiscounts(html, source) {
  // Find the RSC wire-format block that contains the full benefit data
  let decoded = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)) {
    if (m[1].length > 50_000) {
      try {
        decoded = JSON.parse('"' + m[1] + '"');
        if (decoded.includes('member_memberBenefit')) break;
      } catch {
        decoded = '';
      }
    }
  }
  if (!decoded) return [];

  // Derive the base path for individual benefit pages from the source URL,
  // e.g. https://www.obos.no/MEMBER_PATH/BENEFIT_BASE → /MEMBER_PATH/BENEFIT_BASE
  // where BENEFIT_BASE is the pathname from the scrapeFrom URL (without query string).
  const benefitBasePath = new URL(source.url).pathname.split('?')[0];

  // Each benefit object in the RSC payload has this field order:
  // _type → … → categories → … → company{ ingress, title } → … → slug{ current }
  const benefitPattern =
    /"_type":"member_memberBenefit".*?"categories":(\[[^\]]*\]).*?"ingress":"((?:[^"\\]|\\.)*)".*?"title":"([^"]+)"\}.*?"current":"([^"]+)"/gs;

  const results = [];
  const seen = new Set();

  for (const m of decoded.matchAll(benefitPattern)) {
    const [, catsJson, ingress, title, slug] = m;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const cats = [...catsJson.matchAll(/"name":"([^"]+)"/g)].map((c) => c[1]);
    const name = normalizeWhitespace(title);
    const description = ingress ? normalizeWhitespace(ingress.replace(/\\n/g, ' ').replace(/\\"/g, '"')) : null;

    results.push({
      name,
      description,
      categories: cats,
      link: `${source.baseUrl}${benefitBasePath}/${slug}`,
      source: source.name,
      sourceId: source.id,
      scrapedFrom: source.url,
    });
  }

  return results;
}

// Registry of site-specific extractors keyed by source.id
const SOURCE_EXTRACTORS = {
  lofavor: extractLofavorDiscounts,
  'remember-reward': extractRememberRewardDiscounts,
  'obos-medlemsfordeler': extractObosDiscounts,
};

// Registry of multi-URL async scrapers (replace the single-fetch pipeline)
const SOURCE_SCRAPERS = {
  'trumf-netthandel': scrapeTrumfDiscounts,
};

// ─────────────────────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'fordel-aggregator/1.0 (+https://github.com/nuth/fordel-aggregator)',
      'accept-language': 'nb-NO,nb;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export async function scrapeSource(source, clock = () => new Date()) {
  const scrapedAt = clock().toISOString();

  try {
    let discounts;

    const customScraper = SOURCE_SCRAPERS[source.id];
    const customExtractor = SOURCE_EXTRACTORS[source.id];

    if (customScraper) {
      const raw = await customScraper(fetchHtml, source);
      discounts = raw.map((entry) => ({ ...entry, lastScraped: scrapedAt }));
    } else {
      const html = await fetchHtml(source.url);
      const extract = customExtractor ?? extractDiscountsFromHtml;
      discounts = extract(html, source).map((entry) => ({ ...entry, lastScraped: scrapedAt }));
    }

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      scrapedAt,
      count: discounts.length,
      discounts,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? [error.message, error.cause?.message].filter(Boolean).join(': ')
        : String(error);

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      scrapedAt,
      count: 0,
      discounts: [],
      error: message,
    };
  }
}
