import { createEmptyState, icon, refreshIcons } from './ui.js';
import { getActivityDefinitions, getGoalViews, getReadingViews, getStudySubjectViews } from './domain.js';
import { escapeHtml, formatCurrency, formatDate, normalizeSearchText, stripHtml, truncate } from './utils.js';

const RESULT_LIMIT = 5;
const RECENT_LIMIT = 6;
const RECENT_STORAGE_KEY = 'controly.search.recent';

const MODULE_LABELS = {
  activities: 'Atividades',
  goals: 'Metas',
  studies: 'Estudos',
  notes: 'Notas',
  reading: 'Leitura',
  finance: 'Finanças',
  calendar: 'Calendário',
  workouts: 'Treinos',
};

const ACTION_SELECTOR = {
  activities: '[data-action="edit-activity"][data-id="{id}"]',
  goals: '[data-action="edit-goal"][data-id="{id}"]',
  studies: '[data-action="edit-subject"][data-id="{id}"]',
  notes: '[data-action="view-note"][data-id="{id}"]',
  reading: '[data-action="edit-book"][data-id="{id}"]',
  finance: '[data-action="edit-entry"][data-id="{id}"]',
  calendar: '[data-action="edit-event"][data-id="{id}"]',
  workouts: '[data-action="edit-workout"][data-id="{id}"]',
};

function getStoredRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(term) {
  const normalized = String(term || '').trim();
  if (!normalized) return;
  const next = [normalized, ...getStoredRecentSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

function markMatch(text = '', query = '') {
  const safe = escapeHtml(String(text || ''));
  if (!query) return safe;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
}

function moduleBadge(module) {
  return `<span class="chip">${escapeHtml(MODULE_LABELS[module] || module)}</span>`;
}


function simpleDistance(a = '', b = '') {
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function scoreSearchItem(item, query = '') {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(item.title || '');
  const subtitle = normalizeSearchText(item.subtitle || '');
  const content = normalizeSearchText(item.content || '');
  const haystack = `${title} ${subtitle} ${content}`.trim();
  if (!normalizedQuery) return 1;
  if (title.includes(normalizedQuery)) return 100;
  if (haystack.includes(normalizedQuery)) return 80;
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const words = haystack.split(/\s+/).filter(Boolean);
  const matchedTerms = terms.filter((term) => words.some((word) => word.includes(term) || simpleDistance(word, term) <= (term.length > 5 ? 2 : 1)));
  if (matchedTerms.length === terms.length) return 60 + matchedTerms.length;
  if (matchedTerms.length) return 30 + matchedTerms.length;
  return 0;
}

function quickCommandButtons() {
  return `
    <div class="search-quick-actions">
      <button type="button" class="btn btn-secondary btn-small" data-search-quick="activities" data-search-action-selector="[data-action='new-activity']">Criar atividade</button>
      <button type="button" class="btn btn-secondary btn-small" data-search-quick="notes" data-search-action-selector="[data-action='new-note']">Criar nota</button>
      <button type="button" class="btn btn-secondary btn-small" data-search-quick="finance" data-search-action-selector="[data-action='new-entry']">Criar lançamento financeiro</button>
      <button type="button" class="btn btn-secondary btn-small" data-search-quick="calendar" data-search-action-selector="[data-action='new-event']">Criar item na agenda</button>
    </div>`;
}

function moduleFilterButtons(active = 'all') {
  const options = [['all', 'Todos os módulos'], ...Object.entries(MODULE_LABELS)];
  return `<div class="search-module-filter-buttons" role="group" aria-label="Filtrar resultados por área do Controly">${options.map(([value, label]) => `<button type="button" class="chip-button ${active === value ? 'is-active' : ''}" data-search-module-button="${value}" aria-pressed="${active === value}">${escapeHtml(label)}</button>`).join('')}</div>`;
}

export function buildSearchDataset(state) {
  const subjects = getStudySubjectViews(state);
  const studyItems = subjects.flatMap((subject) => [
    { module: 'studies', title: subject.name, subtitle: subject.area, content: stripHtml(subject.notes), date: subject.updatedAt || subject.createdAt || subject.endDate, id: subject.id },
    ...(subject.todos || []).map((todo) => ({
      module: 'studies',
      title: todo.text || 'Tarefa de estudo',
      subtitle: `${subject.name}${todo.done ? ' · concluída' : ' · pendente'}`,
      content: [subject.area, subject.notes].filter(Boolean).join(' '),
      date: subject.updatedAt || subject.createdAt,
      id: subject.id,
    })),
    ...(subject.importantDates || []).map((item) => ({
      module: 'studies',
      title: item.title || 'Data importante',
      subtitle: `${subject.name}${item.type ? ` · ${item.type}` : ''}`,
      content: [subject.area, subject.notes].filter(Boolean).join(' '),
      date: item.date,
      id: subject.id,
    })),
  ]);

  const financeEntries = (state.financeEntries || []).map((item) => ({
    module: 'finance',
    title: item.title || 'Lançamento financeiro',
    subtitle: [item.category, item.cardName, item.status, item.monthKey].filter(Boolean).join(' · '),
    content: item.notes,
    date: item.dueDate || item.monthKey || item.createdAt,
    id: item.id,
    amount: Number(item.amount) || 0,
  }));

  const financeCards = (state.financeCards || []).map((item) => ({
    module: 'finance',
    title: item.name || 'Cartão',
    subtitle: item.type === 'debit' ? 'Cartão de débito' : 'Cartão de crédito',
    content: [`fecha dia ${item.closingDay || ''}`, `vence dia ${item.dueDay || ''}`].join(' '),
    date: item.updatedAt || item.createdAt,
    id: item.id,
  }));

  return [
    ...getActivityDefinitions(state).map((item) => ({ module: 'activities', title: item.title, subtitle: item.category, content: item.notes, date: item.date || item.startDate, id: item.id })),
    ...getGoalViews(state).map((item) => ({ module: 'goals', title: item.title, subtitle: [item.period, item.cycle?.sourceLabel].filter(Boolean).join(' · '), content: [item.notes, item.category, item.unit].filter(Boolean).join(' '), date: item.cycle.end, id: item.id })),
    ...(state.notes || []).map((item) => ({ module: 'notes', title: item.title, subtitle: item.tag, content: stripHtml(item.content || ''), date: item.updatedAt || item.createdAt, id: item.id })),
    ...studyItems,
    ...getReadingViews(state).map((item) => ({ module: 'reading', title: item.title, subtitle: [item.author, item.genre, item.status].filter(Boolean).join(' · '), content: item.notes, date: item.updatedAt || item.createdAt, id: item.id })),
    ...(state.workouts || []).map((item) => ({ module: 'workouts', title: item.title, subtitle: [item.type, item.trainingType, ...(item.trainingTypes || [])].filter(Boolean).join(' · '), content: item.notes, date: item.date, id: item.id })),
    ...financeEntries,
    ...financeCards,
    ...(state.events || []).map((item) => ({ module: 'calendar', title: item.title, subtitle: item.type, content: item.notes, date: item.date, id: item.id })),
  ];
}

function filterDataset(state, query = '', moduleFilter = 'all') {
  const all = buildSearchDataset(state).filter((item) => moduleFilter === 'all' || item.module === moduleFilter);
  if (!query.trim()) return all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return all
    .map((item) => ({ ...item, _score: scoreSearchItem(item, query) }))
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score || String(b.date || '').localeCompare(String(a.date || '')));
}

function groupResults(list) {
  return list.reduce((acc, item) => {
    (acc[item.module] ||= []).push(item);
    return acc;
  }, {});
}

function focusSearchTarget(item) {
  const selector = `[data-search-id="${item.module}:${item.id}"]`;
  const target = document.querySelector(selector);
  if (!target) return false;
  target.classList.add('search-focus-target');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => target.classList.remove('search-focus-target'), 1800);
  return true;
}

function openSearchItem(item) {
  const opener = window.__CONTROLY_OPENERS?.[item.module];
  if (typeof opener === 'function' && opener(item)) return true;
  const selector = (ACTION_SELECTOR[item.module] || '').replace('{id}', item.id);
  if (!selector) return false;
  const button = document.querySelector(selector);
  if (!button) return false;
  button.click();
  return true;
}

export function initGlobalSearch({ getState, navigate }) {
  const palette = document.getElementById('search-palette');
  const input = document.getElementById('search-palette-input');
  const closeButton = document.getElementById('search-palette-close');
  const trigger = document.getElementById('global-search-trigger');
  const resultsRoot = document.getElementById('search-palette-results');
  const recentRoot = document.getElementById('search-palette-recent');
  const metaRoot = document.getElementById('search-palette-meta');
  if (!palette || !input || !resultsRoot || !recentRoot || !metaRoot) return;

  let activeQuery = '';
  let moduleFilter = 'all';
  let expandedModules = new Set();

  function closePalette() {
    palette.classList.remove('open');
    palette.setAttribute('aria-hidden', 'true');
  }

  function openPalette(query = '') {
    palette.classList.add('open');
    palette.setAttribute('aria-hidden', 'false');
    input.value = query;
    activeQuery = query;
    renderPalette();
    window.setTimeout(() => input.focus(), 20);
  }

  function renderRecent() {
    const items = getStoredRecentSearches();
    recentRoot.innerHTML = items.length
      ? `<div class="search-recent-row"><span class="eyebrow">Buscas recentes</span><div class="search-recent-list">${items.map((term) => `<button type="button" class="search-recent-chip" data-search-recent="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join('')}</div></div>`
      : `<div class="search-recent-row is-empty"><span class="module-subtitle">Suas buscas recentes aparecerão aqui para facilitar o próximo acesso.</span></div>`;
  }

  function renderPalette() {
    const state = getState();
    const results = filterDataset(state, activeQuery, moduleFilter);
    const grouped = groupResults(results);
    const total = results.length;
    metaRoot.textContent = activeQuery ? `${total} resultado(s) encontrado(s)` : 'Digite o que procura, filtre por área ou use uma ação rápida';
    renderRecent();

    if (!activeQuery.trim()) {
      resultsRoot.innerHTML = `
        <div class="search-palette-empty">
          <div>
            <strong>Encontre rapidamente o que você precisa</strong>
            <p class="module-subtitle">Busque atividades, metas, estudos, notas, livros, finanças, treinos e itens da agenda em um só lugar.</p>
          </div>
          <div class="search-palette-filterbar">
            ${moduleFilterButtons(moduleFilter)}
            ${quickCommandButtons()}
          </div>
          <div class="search-palette-tips">
            <span class="chip">Ctrl + K abre a busca</span>
            <span class="chip">Esc fecha a janela</span>
            <span class="chip">Setas para navegar</span>
          </div>
        </div>`;
      refreshIcons(palette);
      return;
    }

    const filterBar = `
      <div class="search-palette-filterbar">
        ${moduleFilterButtons(moduleFilter)}
        ${quickCommandButtons()}
      </div>`;

    const sections = Object.entries(grouped).map(([module, items]) => {
      const expanded = expandedModules.has(module);
      const visibleItems = expanded ? items : items.slice(0, RESULT_LIMIT);
      return `
        <section class="search-palette-group">
          <div class="search-palette-group-head">
            <div>
              <strong>${escapeHtml(MODULE_LABELS[module] || module)}</strong>
              <span class="module-subtitle">${items.length} resultado(s)</span>
            </div>
            ${items.length > RESULT_LIMIT ? `<button type="button" class="btn btn-secondary btn-small" data-search-expand="${module}">${expanded ? 'Mostrar menos' : 'Mostrar mais'}</button>` : ''}
          </div>
          <div class="search-palette-group-list">
            ${visibleItems.map((item) => `
              <article class="search-hit-card">
                <div class="search-hit-main">
                  <div class="search-hit-title-row">
                    <strong>${markMatch(item.title || 'Sem título', activeQuery)}</strong>
                    ${moduleBadge(item.module)}
                  </div>
                  <div class="item-meta">
                    ${item.subtitle ? `<span class="chip">${markMatch(item.subtitle, activeQuery)}</span>` : ''}
                    ${item.date ? `<span class="chip">${formatDate(item.date, { day: '2-digit', month: 'short', year: '2-digit' })}</span>` : ''}
                    ${typeof item.amount === 'number' ? `<span class="chip">${formatCurrency(item.amount)}</span>` : ''}
                  </div>
                  ${item.content ? `<p class="module-subtitle">${markMatch(truncate(item.content, 140), activeQuery)}</p>` : ''}
                </div>
                <div class="search-hit-actions">
                  <button type="button" class="btn btn-secondary btn-small" data-search-focus="${item.module}:${item.id}">${icon('crosshair', 'Mostrar na tela')}</button>
                  <button type="button" class="btn btn-primary btn-small" data-search-open="${item.module}:${item.id}">Abrir</button>
                </div>
              </article>`).join('')}
          </div>
        </section>`;
    }).join('');

    resultsRoot.innerHTML = filterBar + (sections || createEmptyState('Nenhum resultado encontrado', 'Tente buscar por outra palavra, usar um termo mais geral ou abrir a área correspondente.'));
    refreshIcons(palette);
  }

  function parseToken(token) {
    const [module, ...idParts] = String(token || '').split(':');
    return { module, id: idParts.join(':') };
  }

  trigger?.addEventListener('click', () => openPalette(activeQuery));
  closeButton?.addEventListener('click', closePalette);
  palette.addEventListener('click', (event) => {
    if (event.target?.dataset?.closeSearch === 'true') closePalette();
    const moduleButton = event.target.closest('[data-search-module-button]');
    if (moduleButton) {
      moduleFilter = moduleButton.dataset.searchModuleButton || 'all';
      renderPalette();
      return;
    }
    const recent = event.target.closest('[data-search-recent]');
    if (recent) {
      input.value = recent.dataset.searchRecent;
      activeQuery = recent.dataset.searchRecent;
      renderPalette();
      input.focus();
      return;
    }
    const quick = event.target.closest('[data-search-quick]');
    if (quick) {
      closePalette();
      navigate(quick.dataset.searchQuick);
      window.setTimeout(() => document.querySelector(quick.dataset.searchActionSelector)?.click(), 180);
      return;
    }
    const expand = event.target.closest('[data-search-expand]');
    if (expand) {
      const module = expand.dataset.searchExpand;
      if (expandedModules.has(module)) expandedModules.delete(module);
      else expandedModules.add(module);
      renderPalette();
      return;
    }
    const focusButton = event.target.closest('[data-search-focus]');
    if (focusButton) {
      const item = parseToken(focusButton.dataset.searchFocus);
      navigate(item.module);
      window.setTimeout(() => focusSearchTarget(item), 180);
      return;
    }
    const openButton = event.target.closest('[data-search-open]');
    if (openButton) {
      const item = parseToken(openButton.dataset.searchOpen);
      saveRecentSearch(activeQuery);
      navigate(item.module);
      closePalette();
      window.setTimeout(() => {
        if (!openSearchItem(item)) focusSearchTarget(item);
      }, 180);
    }
  });

  palette.addEventListener('change', (event) => {
    const filter = event.target.closest('[data-search-module-filter]');
    if (!filter) return;
    moduleFilter = filter.value;
    renderPalette();
    input.focus();
  });

  input.addEventListener('input', (event) => {
    activeQuery = event.target.value;
    renderPalette();
  });

  palette.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const openButtons = [...palette.querySelectorAll('[data-search-open]')];
    if (!openButtons.length) return;
    const currentIndex = openButtons.indexOf(document.activeElement);
    if (event.key === 'Enter' && document.activeElement?.matches?.('[data-search-open]')) return;
    event.preventDefault();
    const nextIndex = event.key === 'ArrowUp'
      ? (currentIndex <= 0 ? openButtons.length - 1 : currentIndex - 1)
      : (currentIndex >= openButtons.length - 1 ? 0 : currentIndex + 1);
    openButtons[nextIndex]?.focus();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette(activeQuery);
      return;
    }
    if (event.key === 'Escape' && palette.classList.contains('open')) {
      closePalette();
    }
  });
}

export function createSearchModule() {
  let root;

  function render(state) {
    if (!root) return;
    const recent = getStoredRecentSearches();
    const dataset = buildSearchDataset(state);
    const grouped = groupResults(dataset);

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head search-section-head">
          <div>
            <span class="eyebrow">Busca rápida</span>
            <h3>Encontre suas informações em um só lugar</h3>
            <p class="module-subtitle">Busque atividades, metas, estudos, notas, livros, finanças, treinos e itens da agenda. Abra o resultado ou veja onde ele está na tela.</p>
          </div>
          <div class="section-actions">
            <button type="button" class="btn btn-primary" data-action="open-global-search">${icon('search', 'Buscar')}Abrir busca</button>
          </div>
        </div>

        <div class="grid-two search-section-grid">
          <article class="panel search-section-card">
            <span class="eyebrow">Áreas pesquisadas</span>
            <h4>O que a busca encontra</h4>
            <div class="search-coverage-grid">
              ${Object.entries(grouped).map(([module, items]) => `<div class="search-coverage-item"><strong>${escapeHtml(MODULE_LABELS[module] || module)}</strong><span>${items.length} item(ns)</span></div>`).join('')}
            </div>
          </article>

          <article class="panel search-section-card">
            <span class="eyebrow">Como usar</span>
            <h4>Atalhos e ações disponíveis</h4>
            <ul class="search-shortcuts-list">
              <li><span class="chip">Ctrl + K</span><span>abre a busca de qualquer tela</span></li>
              <li><span class="chip">Abrir</span><span>leva você diretamente para o item escolhido</span></li>
              <li><span class="chip">Mostrar na tela</span><span>destaca onde o item está dentro da área correspondente</span></li>
              <li><span class="chip">Esc</span><span>fecha a busca quando ela estiver aberta</span></li>
              <li><span class="chip">Filtro</span><span>mostra resultados apenas de uma área, como notas ou finanças</span></li>
            </ul>
            <div class="search-recent-panel">
              <strong>Buscas recentes</strong>
              <div class="search-recent-list">
                ${recent.length ? recent.map((term) => `<button type="button" class="search-recent-chip" data-search-recent-inline="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join('') : '<span class="module-subtitle">Nenhuma busca recente ainda.</span>'}
              </div>
            </div>
          </article>
        </div>
      </div>`;
    refreshIcons(root);
  }

  function init(element) {
    root = element;
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="open-global-search"]')) {
        document.getElementById('global-search-trigger')?.click();
      }
      const recent = event.target.closest('[data-search-recent-inline]');
      if (recent) {
        document.getElementById('global-search-trigger')?.click();
        window.setTimeout(() => {
          const input = document.getElementById('search-palette-input');
          if (input) {
            input.value = recent.dataset.searchRecentInline;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          }
        }, 20);
      }
    });
  }

  return { id: 'search', init, render };
}