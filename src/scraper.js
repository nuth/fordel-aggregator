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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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
    const html = await fetchHtml(source.url);
    const discounts = extractDiscountsFromHtml(html, source).map((entry) => ({
      ...entry,
      lastScraped: scrapedAt,
    }));

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
