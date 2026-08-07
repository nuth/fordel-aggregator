function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHtml({ generatedAt }) {
  return `<!doctype html>
<html lang="no">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Fordelsoversikt</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; background: #111827; color: #f9fafb; }
      main { max-width: 72rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
      h1 { margin-bottom: 0.5rem; }
      .meta, .hint { color: #cbd5e1; }
      .toolbar { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); margin: 1.5rem 0; }
      input, select { width: 100%; padding: 0.8rem; border-radius: 0.75rem; border: 1px solid #475569; background: #0f172a; color: inherit; }
      .summary { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; }
      .pill { display: inline-flex; gap: 0.35rem; align-items: center; padding: 0.35rem 0.65rem; border-radius: 999px; background: #1e293b; color: #e2e8f0; font-size: 0.875rem; }
      .grid { display: grid; gap: 1rem; }
      .card { background: #0f172a; border: 1px solid #334155; border-radius: 1rem; padding: 1rem; }
      .card h2 { margin-top: 0; margin-bottom: 0.75rem; }
      ul { padding-left: 1.1rem; }
      li + li { margin-top: 0.75rem; }
      a { color: #93c5fd; }
      .errors { margin-top: 2rem; }
      .muted { color: #94a3b8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Fordelsoversikt</h1>
      <p class="meta">Sist bygget: ${escapeHtml(generatedAt)}</p>
      <p class="hint">Søk etter sted, kategori, beskrivelse eller kilde. Like steder samles på samme kort, og kategorier slås sammen på tvers av kilder.</p>

      <section class="toolbar" aria-label="Filtre">
        <label>
          <span class="muted">Søk</span>
          <input id="search" type="search" placeholder="F.eks. kino, OBOS, Tusenfryd">
        </label>
        <label>
          <span class="muted">Kategori</span>
          <select id="category">
            <option value="">Alle kategorier</option>
          </select>
        </label>
        <label>
          <span class="muted">Kilde</span>
          <select id="source">
            <option value="">Alle kilder</option>
          </select>
        </label>
      </section>

      <div id="summary" class="summary" aria-live="polite"></div>
      <section id="results" class="grid" aria-live="polite"></section>
      <section id="errors" class="errors"></section>
    </main>
    <script>
      const state = { search: '', category: '', source: '', data: null };

      const searchInput = document.getElementById('search');
      const categorySelect = document.getElementById('category');
      const sourceSelect = document.getElementById('source');
      const summary = document.getElementById('summary');
      const results = document.getElementById('results');
      const errors = document.getElementById('errors');

      function formatDate(value) {
        return new Date(value).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' });
      }

      function option(label, value) {
        const element = document.createElement('option');
        element.value = value;
        element.textContent = label;
        return element;
      }

      function matchesStore(store) {
        const haystack = [
          store.name,
          ...(store.categories || []),
          store.description || '',
          ...store.discounts.flatMap((discount) => [discount.source, discount.description || '', ...(discount.categories || [])]),
        ].join(' ').toLowerCase();

        const matchesSearch = !state.search || haystack.includes(state.search);
        const matchesCategory = !state.category || (store.categories || []).includes(state.category) || store.discounts.some((discount) => (discount.categories || []).includes(state.category));
        const matchesSource = !state.source || store.discounts.some((discount) => discount.source === state.source);
        return matchesSearch && matchesCategory && matchesSource;
      }

      function renderSummary(visibleStores) {
        const visibleDiscounts = visibleStores.reduce((sum, store) => sum + store.discounts.length, 0);
        summary.replaceChildren(
          badge(visibleStores.length + ' steder'),
          badge(visibleDiscounts + ' tilbud'),
          badge((state.data.sources || []).filter((source) => !source.error).length + ' kilder OK')
        );
      }

      function badge(text) {
        const span = document.createElement('span');
        span.className = 'pill';
        span.textContent = text;
        return span;
      }

      function renderStores() {
        const visibleStores = (state.data.stores || []).filter(matchesStore);
        renderSummary(visibleStores);
        results.replaceChildren();

        if (visibleStores.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'card';
          empty.textContent = 'Ingen treff for valgt filter.';
          results.append(empty);
          return;
        }

        for (const store of visibleStores) {
          const card = document.createElement('article');
          card.className = 'card';

          const heading = document.createElement('h2');
          heading.textContent = store.name;
          card.append(heading);

          const meta = document.createElement('div');
          meta.className = 'summary';
          (store.categories || []).forEach((category) => meta.append(badge(category)));
          meta.append(badge(store.discountCount + ' tilbud'));
          card.append(meta);

          if (store.description) {
            const description = document.createElement('p');
            description.textContent = store.description;
            card.append(description);
          }

          const list = document.createElement('ul');
          for (const discount of store.discounts) {
            const item = document.createElement('li');
            const info = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = discount.source;
            info.append(strong, document.createTextNode(' · sist skrapt ' + formatDate(discount.lastScraped)));
            item.append(info);

            if (discount.categories && discount.categories.length > 0) {
              const categories = document.createElement('div');
              categories.className = 'summary';
              discount.categories.forEach((category) => categories.append(badge(category)));
              item.append(categories);
            }

            if (discount.description) {
              const description = document.createElement('p');
              description.textContent = discount.description;
              item.append(description);
            }

            const link = document.createElement('a');
            link.href = discount.link;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.textContent = 'Se kilden';
            item.append(link);
            list.append(item);
          }
          card.append(list);
          results.append(card);
        }
      }

      function renderErrors() {
        const failedSources = (state.data.sources || []).filter((source) => source.error);
        errors.replaceChildren();
        if (failedSources.length === 0) {
          return;
        }

        const card = document.createElement('article');
        card.className = 'card';
        const heading = document.createElement('h2');
        heading.textContent = 'Kilder med feil';
        card.append(heading);
        const list = document.createElement('ul');
        for (const source of failedSources) {
          const item = document.createElement('li');
          item.textContent = source.name + ': ' + source.error;
          list.append(item);
        }
        card.append(list);
        errors.append(card);
      }

      async function initialize() {
        const response = await fetch('./data.json');
        state.data = await response.json();

        const categories = [...new Set(state.data.stores.flatMap((store) => store.categories || []))].sort((a, b) => a.localeCompare(b, 'nb'));
        const sources = [...new Set(state.data.discounts.map((discount) => discount.source))].sort((a, b) => a.localeCompare(b, 'nb'));
        categories.forEach((category) => categorySelect.append(option(category, category)));
        sources.forEach((source) => sourceSelect.append(option(source, source)));

        searchInput.addEventListener('input', () => {
          state.search = searchInput.value.trim().toLowerCase();
          renderStores();
        });
        categorySelect.addEventListener('change', () => {
          state.category = categorySelect.value;
          renderStores();
        });
        sourceSelect.addEventListener('change', () => {
          state.source = sourceSelect.value;
          renderStores();
        });

        renderStores();
        renderErrors();
      }

      initialize().catch((error) => {
        const p = document.createElement('p');
        p.className = 'card';
        p.textContent = 'Kunne ikke laste data: ' + error.message;
        results.replaceChildren(p);
      });
    </script>
  </body>
</html>`;
}
