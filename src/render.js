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
      :root {
        color-scheme: light dark;
        font-family: Inter, system-ui, sans-serif;
        --bg: #f0f4f8;
        --surface: #ffffff;
        --border: #e2e8f0;
        --text: #1e293b;
        --text-muted: #64748b;
        --accent: #2563eb;
        --pill-bg: #e2e8f0;
        --pill-text: #334155;
        --input-bg: #ffffff;
        --input-border: #cbd5e1;
        --shadow: 0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08);
        --shadow-hover: 0 4px 16px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.10);
        --radius: 1rem;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f172a;
          --surface: #1e293b;
          --border: #334155;
          --text: #e2e8f0;
          --text-muted: #94a3b8;
          --accent: #60a5fa;
          --pill-bg: #334155;
          --pill-text: #cbd5e1;
          --input-bg: #1e293b;
          --input-border: #475569;
          --shadow: 0 2px 8px rgba(0,0,0,0.30), 0 1px 3px rgba(0,0,0,0.40);
          --shadow-hover: 0 4px 16px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.40);
        }
      }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); transition: background 0.2s, color 0.2s; }
      main { max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
      header { margin-bottom: 0.25rem; }
      h1 { margin: 0 0 0.25rem; font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .meta { color: var(--text-muted); font-size: 0.875rem; margin: 0 0 0.25rem; }
      .hint { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1.5rem; max-width: 60ch; }
      .toolbar { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); margin: 1.25rem 0 1.75rem; }
      .toolbar label span { display: block; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.35rem; }
      input, select { width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1.5px solid var(--input-border); background: var(--input-bg); color: var(--text); font-size: 0.95rem; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
      input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
      .summary { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1.25rem; }
      .pill { display: inline-flex; gap: 0.35rem; align-items: center; padding: 0.3rem 0.75rem; border-radius: 999px; background: var(--pill-bg); color: var(--pill-text); font-size: 0.82rem; font-weight: 500; }
      .pill-stale { background: #fef3c7; color: #92400e; }
      @media (prefers-color-scheme: dark) { .pill-stale { background: #451a03; color: #fcd34d; } }
      .grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); }
      .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem 1.5rem; box-shadow: var(--shadow); transition: box-shadow 0.2s, transform 0.2s; }
      .card:hover { box-shadow: var(--shadow-hover); transform: translateY(-2px); }
      .card h2 { margin: 0 0 0.75rem; font-size: 1.15rem; font-weight: 700; }
      ul { padding-left: 1.1rem; margin: 0.5rem 0 0; }
      li + li { margin-top: 0.85rem; }
      a { color: var(--accent); text-decoration: none; font-weight: 500; }
      a:hover { text-decoration: underline; }
      .errors { margin-top: 2.5rem; }
      .muted { color: var(--text-muted); }
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

          const list = document.createElement('ul');
          for (const discount of store.discounts) {
            const item = document.createElement('li');
            const info = document.createElement('div');

            const link = document.createElement('a');
            link.href = discount.link;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = discount.source;
            info.append(link, document.createTextNode(' · sist skrapt ' + formatDate(discount.lastScraped)));

            if (discount.stale) {
              const staleBadge = document.createElement('span');
              staleBadge.className = 'pill pill-stale';
              staleBadge.textContent = 'Utdatert';
              info.append(document.createTextNode(' '), staleBadge);
            }

            item.append(info);

            if (discount.description) {
              const description = document.createElement('p');
              description.textContent = discount.description;
              item.append(description);
            }

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
