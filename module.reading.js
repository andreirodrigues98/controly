import { closeModal, confirmDialog, createEmptyState, icon, openModal, showToast, showUndoToast } from './ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from './store.js';
import { getReadingViews } from './domain.js';
import { cleanObjectForWrite, dateKey, escapeHtml, formatMonthLabel, monthKey, toDate } from './utils.js';

const READING_STATUSES = ['Quero ler', 'Lendo', 'Pausado', 'Concluído', 'Abandonado'];
const ACTIVE_READING_STATUSES = ['Lendo', 'Pausado', 'Abandonado'];

function getAllowedReadingStatuses(pagesRead = 0, totalPages = 0) {
  const currentPages = Math.max(0, Number(pagesRead) || 0);
  const total = Math.max(0, Number(totalPages) || 0);

  if (total > 0 && currentPages >= total) return ['Concluído'];
  if (currentPages > 0) return ACTIVE_READING_STATUSES;
  return ['Quero ler'];
}

function normalizeReadingStatus(status, pagesRead = 0, totalPages = 0) {
  const allowedStatuses = getAllowedReadingStatuses(pagesRead, totalPages);
  if (allowedStatuses.includes(status)) return status;
  if (allowedStatuses.includes('Lendo')) return 'Lendo';
  return allowedStatuses[0] || 'Quero ler';
}

function renderStatusOptions(selectedStatus, pagesRead = 0, totalPages = 0) {
  const allowedStatuses = getAllowedReadingStatuses(pagesRead, totalPages);
  const safeStatus = normalizeReadingStatus(selectedStatus, pagesRead, totalPages);
  return allowedStatuses.map((status) => `<option value="${status}" ${safeStatus === status ? 'selected' : ''}>${status}</option>`).join('');
}

function getStatusHint(pagesRead = 0, totalPages = 0) {
  const currentPages = Math.max(0, Number(pagesRead) || 0);
  const total = Math.max(0, Number(totalPages) || 0);

  if (total > 0 && currentPages >= total) return 'Ao chegar ao total de páginas, o livro fica como concluído automaticamente.';
  if (currentPages > 0) return 'Com páginas já lidas, este livro só pode ficar como Lendo, Pausado ou Abandonado. Para voltar para Quero ler, zere as páginas lidas.';
  return 'Sem páginas lidas, o livro fica na lista Quero ler. Ao registrar páginas, ele passa a permitir apenas Lendo, Pausado ou Abandonado.';
}

function getStatusClass(status) {
  if (status === 'Concluído') return 'success';
  if (status === 'Lendo') return 'medium';
  if (status === 'Pausado') return 'high';
  if (status === 'Abandonado') return 'danger';
  return 'low';
}

function groupByMonth(books) {
  const groups = new Map();
  books.forEach((book) => {
    const key = monthKey(book.updatedAt || book.createdAt || new Date());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function createReadingModule() {
  let root;
  let statusFilter = 'all';

  function openBookForm(book = null) {
    const initialTotalPages = Number(book?.totalPages || 0);
    const initialPagesRead = Number(book?.pagesRead || 0);
    const initialStatus = normalizeReadingStatus(book?.status || book?.readingStatus || '', initialPagesRead, initialTotalPages);

    openModal({
      title: book ? 'Editar livro' : 'Adicionar novo livro',
      eyebrow: 'Organização da leitura',
      body: `
        <form id="reading-form" class="stack-form">
          <label class="field"><span>Nome do livro</span><input class="input" name="title" value="${escapeHtml(book?.title || '')}" placeholder="Ex.: O Pequeno Príncipe" required /></label>
          <div class="inline-fields">
            <label class="field"><span>Autor</span><input class="input" name="author" value="${escapeHtml(book?.author || '')}" placeholder="Ex.: Antoine de Saint-Exupéry" required /></label>
            <label class="field"><span>Categoria ou gênero</span><input class="input" name="genre" value="${escapeHtml(book?.genre || book?.category || '')}" placeholder="Ex.: Romance, estudos, negócios" /></label>
          </div>
          <div class="inline-fields">
            <label class="field"><span>Total de páginas do livro</span><input class="input" type="number" min="1" name="totalPages" value="${book?.totalPages || ''}" required /></label>
            <label class="field"><span>Páginas que você já leu</span><input class="input" type="number" min="0" name="pagesRead" value="${book?.pagesRead || 0}" required /></label>
          </div>
          <div class="inline-fields">
            <label class="field"><span>Status da leitura</span><select class="select" name="status">${renderStatusOptions(initialStatus, initialPagesRead, initialTotalPages)}</select><small id="reading-status-hint" class="module-subtitle">${getStatusHint(initialPagesRead, initialTotalPages)}</small></label>
            <label class="field"><span>Meta diária de páginas (opcional)</span><input class="input" type="number" min="0" name="dailyGoal" value="${book?.dailyGoal || book?.pagesPerDay || ''}" placeholder="Ex.: 20" /></label>
          </div>
          <label class="field"><span>Notas, ideias ou citações do livro</span><textarea class="textarea" name="notes" placeholder="Anote uma frase, ideia importante ou comentário sobre esta leitura.">${escapeHtml(book?.notes || '')}</textarea></label>
          <div class="inline-actions"><button type="button" id="reading-form-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">${book ? 'Salvar livro' : 'Adicionar livro'}</button></div>
        </form>
      `,
    });

    const form = document.getElementById('reading-form');
    const statusSelect = form?.elements?.status;
    const totalPagesInput = form?.elements?.totalPages;
    const pagesReadInput = form?.elements?.pagesRead;
    const statusHint = document.getElementById('reading-status-hint');

    function refreshStatusOptions() {
      if (!statusSelect || !totalPagesInput || !pagesReadInput) return;
      const totalPages = Number(totalPagesInput.value) || 0;
      const pagesRead = Number(pagesReadInput.value) || 0;
      statusSelect.innerHTML = renderStatusOptions(statusSelect.value, pagesRead, totalPages);
      if (statusHint) statusHint.textContent = getStatusHint(pagesRead, totalPages);
    }

    totalPagesInput?.addEventListener('input', refreshStatusOptions);
    pagesReadInput?.addEventListener('input', refreshStatusOptions);
    document.getElementById('reading-form-cancel')?.addEventListener('click', closeModal);

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const totalPages = Number(data.get('totalPages')) || 0;
      const pagesRead = Number(data.get('pagesRead')) || 0;
      if (pagesRead < 0 || totalPages <= 0 || pagesRead > totalPages) {
        showToast('As páginas lidas precisam ficar entre 0 e o total de páginas do livro.', 'error');
        return;
      }
      const previousPages = Number(book?.pagesRead || 0);
      const readingLog = Array.isArray(book?.readingLog) ? [...book.readingLog] : [];
      if (book && pagesRead !== previousPages) {
        readingLog.unshift({ id: crypto.randomUUID(), date: dateKey(new Date()), pagesRead, delta: pagesRead - previousPages });
      }
      const nextStatus = normalizeReadingStatus(data.get('status') || '', pagesRead, totalPages);

      const payload = {
        title: data.get('title')?.trim(),
        author: data.get('author')?.trim(),
        genre: data.get('genre')?.trim(),
        totalPages,
        pagesRead,
        status: nextStatus,
        dailyGoal: Number(data.get('dailyGoal')) || 0,
        notes: data.get('notes')?.trim(),
        readingLog: readingLog.slice(0, 90),
      };
      try {
        const previous = book ? cleanObjectForWrite(book) : null;
        await saveRecord('readingItems', payload, book?.id || null);
        closeModal();
        if (book && previous) showUndoToast('Livro atualizado. Se precisar, você pode desfazer essa alteração.', () => saveRecord('readingItems', previous, book.id));
        else showToast('Livro adicionado com sucesso.');
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar o livro. Confira as informações e tente novamente.', 'error');
      }
    });
  }


  function openReadingProgressForm(book) {
    openModal({
      title: 'Atualizar páginas',
      eyebrow: book.title || 'Leitura',
      body: `
        <form id="reading-progress-form" class="stack-form">
          <p class="module-subtitle">Atualize apenas a página em que você parou. O Controly calcula o progresso e ajusta o status automaticamente. Se zerar as páginas lidas, o livro volta para Quero ler.</p>
          <label class="field"><span>Página atual</span><input class="input" type="number" min="0" max="${book.totalPages || 99999}" name="pagesRead" value="${book.pagesRead || 0}" required /></label>
          <div class="inline-actions"><button type="button" id="reading-progress-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">Salvar páginas</button></div>
        </form>
      `,
    });
    document.getElementById('reading-progress-cancel')?.addEventListener('click', closeModal);
    document.getElementById('reading-progress-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const pagesRead = Number(new FormData(event.currentTarget).get('pagesRead')) || 0;
      const totalPages = Number(book.totalPages || 0);
      if (pagesRead < 0 || (totalPages > 0 && pagesRead > totalPages)) {
        showToast('As páginas lidas precisam ficar entre 0 e o total de páginas do livro.', 'error');
        return;
      }
      const previous = cleanObjectForWrite(book);
      const readingLog = Array.isArray(book.readingLog) ? [...book.readingLog] : [];
      if (pagesRead !== Number(book.pagesRead || 0)) {
        readingLog.unshift({ id: crypto.randomUUID(), date: dateKey(new Date()), pagesRead, delta: pagesRead - Number(book.pagesRead || 0) });
      }
      const nextStatus = normalizeReadingStatus(book.status || '', pagesRead, totalPages);
      try {
        await patchRecord('readingItems', book.id, {
          pagesRead,
          status: nextStatus,
          readingLog: readingLog.slice(0, 90),
        });
        closeModal({ force: true });
        showUndoToast('Leitura atualizada.', () => saveRecord('readingItems', previous, book.id));
      } catch (error) {
        console.error(error);
        showToast('Não foi possível atualizar a leitura. Tente novamente.', 'error');
      }
    });
  }


  async function handleDelete(book) {
    const confirmed = await confirmDialog({ title: 'Excluir livro', description: 'Este livro será enviado para a lixeira e poderá ser restaurado por 7 dias antes de ser apagado definitivamente.', confirmLabel: 'Enviar para a lixeira' });
    if (!confirmed) return;
    try {
      const result = await deleteRecord('readingItems', book.id);
      showUndoToast('Livro enviado para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir o livro. Tente novamente.', 'error');
    }
  }

  function bookCard(book) {
    return `
      <article class="note-card" data-search-id="reading:${book.id}">
        <div class="card-top">
          <div>
            <strong>${escapeHtml(book.title)}</strong>
            <div class="card-meta"><span class="chip">${escapeHtml(book.author)}</span><span class="tag ${getStatusClass(book.status)}">${escapeHtml(book.status)}</span></div>
          </div>
          <div class="inline-actions"><button type="button" class="icon-btn small" data-action="update-reading" data-id="${book.id}">${icon('book-marked', 'Atualizar páginas')}</button><button type="button" class="icon-btn small" data-action="edit-book" data-id="${book.id}">${icon('pencil-line', 'Editar livro')}</button><button type="button" class="icon-btn small" data-action="delete-book" data-id="${book.id}">${icon('trash-2', 'Excluir livro')}</button></div>
        </div>
        <p class="module-subtitle">${book.pagesRead}/${book.totalPages} páginas lidas${book.genre ? ` · ${escapeHtml(book.genre)}` : ''}${book.dailyGoal ? ` · meta de ${book.dailyGoal} pág./dia` : ''}${book.estimatedDays ? ` · previsão: ${book.estimatedDays} dia(s)` : ''}</p>
        <div class="progress"><span style="width:${book.progress}%"></span></div>
        ${book.notes ? `<p class="module-subtitle">${escapeHtml(book.notes)}</p>` : ''}
      </article>
    `;
  }

  function getReadingGridClass(count) {
    if (count <= 1) return 'reading-books-grid reading-books-count-1';
    if (count === 2) return 'reading-books-grid reading-books-count-2';
    return 'reading-books-grid reading-books-count-3';
  }

  function renderGroup(title, books, open = false, emptyText = 'Nenhum livro nesta seção.') {
    const gridClass = getReadingGridClass(books.length);
    return `
      <details class="section-accordion" ${open ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <strong>${title}</strong>
            <div class="section-accordion-meta"><span class="chip">${books.length} ${books.length === 1 ? 'livro' : 'livros'}</span></div>
          </div>
        </summary>
        <div class="section-accordion-body">${books.length ? `<div class="grid-three ${gridClass}">${books.map(bookCard).join('')}</div>` : createEmptyState(`Nenhum livro em ${title}`, emptyText)}</div>
      </details>
    `;
  }

  function render(state) {
    if (!root) return;
    const allBooks = getReadingViews(state);
    const books = statusFilter === 'all' ? allBooks : allBooks.filter((book) => book.status === statusFilter);
    const currentMonthValue = monthKey(new Date());
    const readingNow = books.filter((book) => book.status === 'Lendo');
    const toRead = books.filter((book) => book.status === 'Quero ler');
    const paused = books.filter((book) => book.status === 'Pausado');
    const done = books.filter((book) => book.status === 'Concluído');
    const abandoned = books.filter((book) => book.status === 'Abandonado');
    const archive = groupByMonth(books).filter(([key]) => key !== currentMonthValue);

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div><span class="eyebrow">Minha leitura</span><h3>Livros</h3><p class="module-subtitle">Acompanhe seus livros, páginas lidas, status da leitura, ritmo diário e anotações importantes.</p></div>
          <div class="section-actions"><button class="btn btn-primary" type="button" data-action="new-book">Adicionar livro</button></div>
        </div>
        <article class="panel">
          <div class="filter-row">
            <label class="field"><span>Filtrar livros por status</span><select class="select" id="reading-status-filter"><option value="all">Todos os livros</option>${READING_STATUSES.map((status) => `<option value="${status}" ${statusFilter === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
          </div>
        </article>
        <div class="reading-status-grid section-accordion-stack">
          ${renderGroup('Lendo agora', readingNow, true, 'Quando um livro estiver com status Lendo, ele aparecerá aqui com o progresso da leitura e a previsão de conclusão.')}
          ${toRead.length || statusFilter !== 'all' ? renderGroup('Quero ler', toRead, false, 'Livros que você pretende ler aparecerão aqui para ajudar no planejamento das próximas leituras.') : ''}
          ${paused.length || statusFilter !== 'all' ? renderGroup('Pausados', paused, false, 'Livros pausados ficam aqui para você retomar quando quiser.') : ''}
          ${done.length || statusFilter !== 'all' ? renderGroup('Livros concluídos', done, false, 'Livros concluídos aparecerão aqui para manter seu histórico de leitura.') : ''}
          ${abandoned.length || statusFilter !== 'all' ? renderGroup('Abandonados', abandoned, false, 'Livros abandonados aparecerão aqui caso você escolha esse status.') : ''}
          ${archive.map(([key, items]) => `
            <details class="section-accordion month-accordion">
              <summary><div class="section-accordion-head"><strong>${escapeHtml(formatMonthLabel(toDate(`${key}-01`)))}</strong><div class="section-accordion-meta"><span class="chip">${items.length} livros</span></div></div></summary>
              <div class="section-accordion-body"><div class="grid-three ${getReadingGridClass(items.length)}">${items.map(bookCard).join('')}</div></div>
            </details>
          `).join('')}
          ${books.length ? '' : createEmptyState('Nenhum livro cadastrado', 'Adicione uma leitura para acompanhar páginas, status e progresso.', { label: 'Adicionar leitura', action: 'new-book' })}
        </div>
      </div>
    `;
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.reading = ({ id } = {}) => {
      const book = getReadingViews(window.__CONTROLY_STATE || {}).find((item) => item.id === id);
      if (book) { openBookForm(book); return true; }
      return false;
    };
    root.addEventListener('change', (event) => {
      if (event.target.id === 'reading-status-filter') {
        statusFilter = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });

    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const book = getReadingViews(window.__CONTROLY_STATE).find((item) => item.id === button.dataset.id);
      if (action === 'new-book') openBookForm();
      if (action === 'edit-book' && book) openBookForm(book);
      if (action === 'update-reading' && book) openReadingProgressForm(book);
      if (action === 'complete-book' && book) {
        const totalPages = Number(book.totalPages || 0);
        const pagesRead = Number(book.pagesRead || 0);
        if (!totalPages || pagesRead < totalPages) {
          showToast('Para concluir o livro, atualize a página atual até o total de páginas.', 'error');
          return;
        }
        const previous = cleanObjectForWrite(book);
        try {
          await patchRecord('readingItems', book.id, { status: 'Concluído', pagesRead: totalPages });
          showUndoToast('Livro marcado como concluído.', () => saveRecord('readingItems', previous, book.id));
        } catch (error) {
          console.error(error);
          showToast('Não foi possível concluir o livro. Tente novamente.', 'error');
        }
      }
      if (action === 'delete-book' && book) await handleDelete(book);
    });
  }

  return { id: 'reading', init, render };
}
