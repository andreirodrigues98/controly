import { confirmDialog, createEmptyState, icon, refreshIcons, showToast } from './ui.js';
import { deleteTrashItem, emptyExpiredTrashNow, restoreDeletedRecord } from './store.js';
import { escapeHtml, formatDate, toDate } from './utils.js';

const MODULE_ORDER = ['Todos', 'Atividades', 'Calendário', 'Metas', 'Estudos', 'Leitura', 'Treinos', 'Finanças', 'Notas', 'Outros'];

const COLLECTION_TO_MODULE = {
  activities: 'Atividades',
  tasks: 'Atividades',
  habits: 'Atividades',
  routines: 'Atividades',
  events: 'Calendário',
  goals: 'Metas',
  subjects: 'Estudos',
  studySessions: 'Estudos',
  studyMaterials: 'Estudos',
  readingItems: 'Leitura',
  workouts: 'Treinos',
  financeEntries: 'Finanças',
  financeCards: 'Finanças',
  notes: 'Notas',
};

const TYPE_LABELS = {
  recurring: 'Atividade recorrente',
  'one-time': 'Atividade única',
  task: 'Tarefa',
  habit: 'Hábito',
  routine: 'Rotina',
  income: 'Entrada',
  expense: 'Despesa',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  done: 'Concluído',
  pending: 'Pendente',
  completed: 'Concluído',
  archived: 'Arquivado',
  gym: 'Academia / Musculação',
  running: 'Corrida',
  cardio: 'Aeróbico / Cardio',
  other: 'Outro item',
};

function moduleNameForTrash(item = {}) {
  return item.originalModule || COLLECTION_TO_MODULE[item.originalCollection] || COLLECTION_TO_MODULE[item.deletedFrom] || 'Outros';
}

function typeLabel(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return TYPE_LABELS[raw] || TYPE_LABELS[raw.toLowerCase()] || raw;
}

function remainingText(expiresAt) {
  const expires = toDate(expiresAt);
  if (!expires) return 'Prazo de remoção não informado';
  const today = new Date();
  const diffMs = expires.getTime() - today.getTime();
  const days = Math.ceil(diffMs / 86400000);
  if (days <= 0) return 'Será apagado definitivamente hoje';
  if (days === 1) return 'Será apagado definitivamente amanhã';
  return `Será apagado definitivamente em ${days} dias`;
}

function deletedAtText(value) {
  const date = toDate(value);
  return date ? formatDate(date, { day: '2-digit', month: 'long', year: 'numeric' }) : 'Data não informada';
}

function expiresAtText(value) {
  const date = toDate(value);
  return date ? formatDate(date, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Prazo não informado';
}

function normalizeTrashItem(item = {}) {
  const restoreData = item.restoreData || {};
  return {
    ...item,
    title: item.title || restoreData.title || restoreData.name || restoreData.subjectName || restoreData.cardName || 'Item excluído',
    module: moduleNameForTrash(item),
    type: typeLabel(item.itemType || restoreData.type || restoreData.kind || restoreData.trainingType || item.originalCollection || ''),
  };
}

export function createTrashModule() {
  let root;
  let moduleFilter = 'Todos';
  const selectedTrashIds = new Set();

  function getFilteredItems(state) {
    const items = (state.trash || []).map(normalizeTrashItem);
    const filtered = moduleFilter === 'Todos' ? items : items.filter((item) => item.module === moduleFilter);
    return { items, filtered };
  }

  function renderTrashItem(raw) {
    const item = normalizeTrashItem(raw);
    const selected = selectedTrashIds.has(item.id);
    return `
      <article class="trash-item-card ${selected ? 'is-selected' : ''}" data-search-id="trash:${item.id}">
        <div class="trash-item-main">
          <div class="trash-item-title-row">
            <label class="trash-select-line" title="Selecionar este item">
              <input type="checkbox" data-action="toggle-trash-select" data-id="${item.id}" ${selected ? 'checked' : ''} />
              <span>Selecionar</span>
            </label>
            <strong class="trash-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
            <span class="chip">${escapeHtml(item.module)}</span>
          </div>
          <div class="item-meta trash-item-meta">
            ${item.type ? `<span class="chip truncate-chip" title="${escapeHtml(item.type)}">${escapeHtml(item.type)}</span>` : ''}
            <span class="chip">Excluído em ${deletedAtText(item.deletedAt)}</span>
            <span class="chip">Pode ser restaurado</span>
            <span class="tag high">${escapeHtml(remainingText(item.expiresAt))}</span>
          </div>
          <p class="module-subtitle">Ao restaurar, este item volta para ${escapeHtml(item.module)} com as informações preservadas. Exclusão definitiva prevista para ${escapeHtml(expiresAtText(item.expiresAt))}.</p>
        </div>
        <div class="trash-item-actions inline-actions">
          <button type="button" class="btn btn-secondary btn-small" data-action="restore-trash" data-id="${item.id}">${icon('undo-2', 'Restaurar item')}Restaurar</button>
          <button type="button" class="btn btn-danger btn-small" data-action="delete-trash" data-id="${item.id}">${icon('trash-2', 'Apagar definitivamente')}Apagar definitivamente</button>
        </div>
      </article>
    `;
  }

  async function restoreMany(ids = []) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    const results = await Promise.allSettled(uniqueIds.map((id) => restoreDeletedRecord(id)));
    selectedTrashIds.clear();
    const restored = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - restored;
    if (restored) showToast(`${restored} item(ns) restaurado(s). Eles voltaram para a área de origem.`);
    if (failed) showToast(`${failed} item(ns) não puderam ser restaurados. Tente novamente.`, 'error');
  }

  async function deleteMany(ids = [], all = false) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    const confirmed = await confirmDialog({
      title: all ? 'Esvaziar lixeira' : 'Apagar definitivamente',
      description: `Você vai apagar ${uniqueIds.length} ${uniqueIds.length === 1 ? 'item' : 'itens'} da lixeira. Depois disso, não será possível restaurar.`,
      confirmLabel: all ? 'Esvaziar lixeira' : 'Apagar definitivamente',
    });
    if (!confirmed) return;
    const results = await Promise.allSettled(uniqueIds.map((id) => deleteTrashItem(id)));
    selectedTrashIds.clear();
    const deleted = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - deleted;
    if (deleted) showToast(`${deleted} item(ns) apagado(s) definitivamente.`);
    if (failed) showToast(`${failed} item(ns) não puderam ser apagados. Tente novamente.`, 'error');
  }

  function render(state) {
    if (!root) return;
    const { items, filtered } = getFilteredItems(state);
    const visibleIds = new Set(filtered.map((item) => item.id));
    [...selectedTrashIds].forEach((id) => { if (!items.some((item) => item.id === id)) selectedTrashIds.delete(id); });
    const selectedVisibleCount = [...selectedTrashIds].filter((id) => visibleIds.has(id)).length;
    const modules = MODULE_ORDER.filter((label) => label === 'Todos' || items.some((item) => item.module === label));

    root.innerHTML = `
      <div class="section-shell trash-shell">
        <div class="section-head">
          <div>
            <span class="eyebrow">Recuperação de itens</span>
            <h3>Lixeira</h3>
            <p class="module-subtitle">Os itens excluídos ficam aqui por até 7 dias. Você pode restaurar o que precisar ou apagar definitivamente quando tiver certeza.</p>
          </div>
        </div>

        <div class="compact-stat-grid mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Itens na lixeira</span><strong>${items.length}</strong></article>
          <article class="stat-card"><span class="label">Itens restauráveis</span><strong>${items.length}</strong></article>
          <article class="stat-card"><span class="label">Itens selecionados</span><strong>${selectedTrashIds.size}</strong></article>
          <article class="stat-card"><span class="label">Filtro aplicado</span><strong>${escapeHtml(moduleFilter)}</strong></article>
        </div>

        <article class="panel">
          <div class="filter-row">
            <label class="field"><span>Filtrar por área</span><select class="select" id="trash-module-filter">${modules.map((label) => `<option value="${escapeHtml(label)}" ${moduleFilter === label ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
          </div>
          <div class="muted-box">Revise antes de apagar definitivamente. Os itens ainda podem ser restaurados dentro do prazo indicado.</div>
        </article>

        <article class="panel trash-bulk-panel">
          <div class="trash-bulk-copy">
            <strong>Ações da lixeira</strong>
            <span>${selectedVisibleCount ? `${selectedVisibleCount} item(ns) selecionado(s)` : `${filtered.length} item(ns) no filtro atual`}</span>
          </div>
          <div class="trash-bulk-actions">
            <label class="checkbox-line trash-select-all"><input type="checkbox" id="trash-select-all-visible" ${filtered.length && selectedVisibleCount === filtered.length ? 'checked' : ''} ${filtered.length ? '' : 'disabled'} /> <span>Selecionar itens visíveis</span></label>
            <button type="button" class="btn btn-secondary btn-small" data-action="restore-selected-trash" ${selectedVisibleCount ? '' : 'disabled'}>${icon('undo-2', 'Restaurar selecionados')}Restaurar selecionados</button>
            <button type="button" class="btn btn-secondary btn-small" data-action="restore-all-trash" ${items.length ? '' : 'disabled'}>${icon('rotate-ccw', 'Restaurar todos')}Restaurar todos</button>
            <button type="button" class="btn btn-danger btn-small" data-action="delete-selected-trash" ${selectedVisibleCount ? '' : 'disabled'}>${icon('trash-2', 'Apagar selecionados')}Apagar selecionados</button>
            <button type="button" class="btn btn-danger btn-small" data-action="empty-trash" ${items.length ? '' : 'disabled'}>${icon('trash', 'Esvaziar lixeira')}Esvaziar lixeira</button>
          </div>
        </article>

        <div class="trash-list">
          ${filtered.length ? filtered.map(renderTrashItem).join('') : createEmptyState('Nenhum item na lixeira', 'Quando você excluir algo, ele aparecerá aqui por 7 dias antes de ser apagado definitivamente.')}
        </div>
      </div>
    `;
    refreshIcons(root);
  }

  function init(element) {
    root = element;
    emptyExpiredTrashNow().catch(() => {});
    root.addEventListener('change', (event) => {
      if (event.target.id === 'trash-module-filter') {
        moduleFilter = event.target.value;
        render(window.__CONTROLY_STATE);
      }
      if (event.target.dataset.action === 'toggle-trash-select') {
        if (event.target.checked) selectedTrashIds.add(event.target.dataset.id);
        else selectedTrashIds.delete(event.target.dataset.id);
        render(window.__CONTROLY_STATE);
      }
      if (event.target.id === 'trash-select-all-visible') {
        const { filtered } = getFilteredItems(window.__CONTROLY_STATE);
        filtered.forEach((item) => {
          if (event.target.checked) selectedTrashIds.add(item.id);
          else selectedTrashIds.delete(item.id);
        });
        render(window.__CONTROLY_STATE);
      }
    });
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      const { items, filtered } = getFilteredItems(window.__CONTROLY_STATE);
      const selectedVisibleIds = [...selectedTrashIds].filter((selectedId) => filtered.some((item) => item.id === selectedId));

      if (action === 'restore-selected-trash') {
        await restoreMany(selectedVisibleIds);
        return;
      }
      if (action === 'restore-all-trash') {
        await restoreMany(items.map((item) => item.id));
        return;
      }
      if (action === 'delete-selected-trash') {
        await deleteMany(selectedVisibleIds, false);
        return;
      }
      if (action === 'empty-trash') {
        await deleteMany(items.map((item) => item.id), true);
        return;
      }

      const item = items.find((entry) => entry.id === id);
      if (!item) return;

      if (action === 'restore-trash') {
        try {
          const result = await restoreDeletedRecord(id);
          selectedTrashIds.delete(id);
          const restoredModule = moduleNameForTrash({ ...item, originalCollection: result.collectionName });
          showToast(`Item restaurado em ${restoredModule}.`);
        } catch (error) {
          console.error(error);
          showToast('Não foi possível restaurar este item. Tente novamente.', 'error');
        }
      }

      if (action === 'delete-trash') {
        await deleteMany([id], false);
      }
    });
  }

  return { id: 'trash', init, render };
}