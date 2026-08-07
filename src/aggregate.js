function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'nb'));
}

export function normalizeStoreName(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
    });

    if (discount.lastScraped > store.lastScraped) {
      store.lastScraped = discount.lastScraped;
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
      discountCount: store.discounts.length,
      discounts: store.discounts.sort((left, right) => {
        const bySource = left.source.localeCompare(right.source, 'nb');
        return bySource || left.name.localeCompare(right.name, 'nb');
      }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'nb'));
}
