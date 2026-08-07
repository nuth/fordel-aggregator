function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'nb'));
}

export function normalizeStoreName(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.[a-z]{2,}(?=\s|$)/g, '')
    .replace(/^(rabatt hos|hotellrabatt|rabatt pa)\s+/i, '')
    .replace(/&/g, ' og ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeDescription(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : null;
}

export function aggregateDiscounts(discounts) {
  const stores = new Map();

  for (const discount of discounts) {
    const key = normalizeStoreName(discount.name);
    if (!key) {
      continue;
    }

    if (!stores.has(key)) {
      stores.set(key, {
        slug: key.replace(/\s+/g, '-'),
        name: discount.name,
        categories: new Set(),
        descriptions: new Set(),
        discounts: [],
        lastScraped: discount.lastScraped,
        firstScraped: discount.firstScraped ?? discount.lastScraped,
      });
    }

    const store = stores.get(key);
    for (const category of discount.categories ?? []) {
      if (category) {
        store.categories.add(category);
      }
    }

    const description = normalizeDescription(discount.description);
    if (description) {
      store.descriptions.add(description);
    }

    store.discounts.push({
      ...discount,
      categories: uniqueSorted(discount.categories ?? []),
      description,
      isNew: !!(discount.firstScraped && discount.firstScraped === discount.lastScraped),
    });

    if (discount.lastScraped > store.lastScraped) {
      store.lastScraped = discount.lastScraped;
    }
    const discountFirstScraped = discount.firstScraped ?? discount.lastScraped;
    if (discountFirstScraped < store.firstScraped) {
      store.firstScraped = discountFirstScraped;
    }
  }

  // Merge single-word entries into matching multi-word entries.
  // A single-word key matches a multi-word key when the multi-word key starts
  // with that single word followed by a space.
  const singleWordKeys = [...stores.keys()].filter((k) => !k.includes(' '));
  for (const singleKey of singleWordKeys) {
    const multiKeys = [...stores.keys()].filter(
      (k) => k.includes(' ') && k.startsWith(singleKey + ' '),
    );
    if (multiKeys.length === 0) {
      continue;
    }
    // Determine the canonical key: prefer the first multiword key alphabetically
    const canonicalKey = multiKeys.sort()[0];
    const canonical = stores.get(canonicalKey);
    // Merge all matching keys (including the single-word one) into the canonical
    const keysToMerge = [singleKey, ...multiKeys.filter((k) => k !== canonicalKey)];
    for (const key of keysToMerge) {
      const entry = stores.get(key);
      for (const category of entry.categories) {
        canonical.categories.add(category);
      }
      for (const description of entry.descriptions) {
        if (description) canonical.descriptions.add(description);
      }
      for (const discount of entry.discounts) {
        canonical.discounts.push(discount);
      }
      if (entry.lastScraped > canonical.lastScraped) {
        canonical.lastScraped = entry.lastScraped;
      }
      if (entry.firstScraped < canonical.firstScraped) {
        canonical.firstScraped = entry.firstScraped;
      }
      stores.delete(key);
    }
  }

  return [...stores.values()]
    .map((store) => ({
      slug: store.slug,
      name: store.name,
      categories: uniqueSorted([...store.categories]),
      description: [...store.descriptions][0] ?? null,
      descriptions: [...store.descriptions],
      lastScraped: store.lastScraped,
      firstScraped: store.firstScraped,
      discountCount: store.discounts.length,
      discounts: store.discounts.sort((left, right) => {
        const bySource = left.source.localeCompare(right.source, 'nb');
        return bySource || left.name.localeCompare(right.name, 'nb');
      }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'nb'));
}
