import { closeModal, confirmDialog, createEmptyState, icon, openModal, showToast, showUndoToast } from '../ui/ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from '../services/store.js';
import { getReadingViews } from '../domain/domain.js';
import { cleanObjectForWrite, dateKey, escapeHtml } from '../shared/utils.js';
import { normalizeQuickTitle } from '../features/quick-entry.js';
import { READING_COLUMNS, nextReadingProgress, readingMoveNeedsReset } from '../features/kanban.js';
import { enableTouchKanban } from '../ui/touch-kanban.js';

const READING_STATUSES = ['Quero ler', 'Lendo', 'Pausado', 'Concluído', 'Abandonado'];

function getAllowedReadingStatuses() {
  // A coluna é escolhida pela pessoa; o número de páginas é um dado separado.
  return READING_STATUSES;
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
  if (totalPages > 0 && pagesRead >= totalPages) return 'Ao chegar à última página, a leitura fica concluída.';
  return 'Mude de etapa quando quiser. O progresso em páginas é guardado separadamente.';
}

function getStatusClass(status) {
  if (status === 'Concluído') return 'success';
  if (status === 'Lendo') return 'medium';
  if (status === 'Pausado') return 'high';
  if (status === 'Abandonado') return 'danger';
  return 'low';
}

export function createReadingModule() {
  let root;

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
            <label class="field"><span>Autor</span><input class="input" name="author" value="${escapeHtml(book?.author || '')}" placeholder="Ex.: Antoine de Saint-Exupéry" /></label>
            <label class="field"><span>Categoria ou gênero</span><input class="input" name="genre" value="${escapeHtml(book?.genre || book?.category || '')}" placeholder="Ex.: Romance, estudos, negócios" /></label>
          </div>
          <div class="inline-fields">
            <label class="field"><span>Total de páginas do livro</span><input class="input" type="number" min="0" name="totalPages" value="${book?.totalPages || ''}" /></label>
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
      if (pagesRead < 0 || (totalPages > 0 && pagesRead > totalPages) || (pagesRead > 0 && totalPages <= 0)) {
        showToast('Se informar páginas lidas, preencha também o total do livro.', 'error');
        return;
      }
      const previousPages = Number(book?.pagesRead || 0);
      const readingLog = Array.isArray(book?.readingLog) ? [...book.readingLog] : [];
      if (book && pagesRead !== previousPages) {
        readingLog.unshift({ id: crypto.randomUUID(), date: dateKey(new Date()), pagesRead, delta: pagesRead - previousPages });
      }
      const requestedStatus = normalizeReadingStatus(data.get('status') || '', pagesRead, totalPages);
      if (requestedStatus === 'Quero ler' && pagesRead > 0) {
        showToast('Para voltar a Quero ler, atualize primeiro as páginas para zero ou mova o cartão e confirme.', 'error');
        return;
      }
      const nextStatus = totalPages > 0 && pagesRead >= totalPages ? 'Concluído' : requestedStatus;

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
      const nextStatus = totalPages > 0 && pagesRead >= totalPages ? 'Concluído' : (pagesRead > 0 && book.status === 'Quero ler' ? 'Lendo' : book.status || 'Quero ler');
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
            <div class="card-meta">${book.author ? `<span class="chip">${escapeHtml(book.author)}</span>` : ''}<span class="tag ${getStatusClass(book.status)}">${escapeHtml(book.status)}</span></div>
          </div>
          <div class="inline-actions"><button type="button" class="icon-btn small" data-action="update-reading" data-id="${book.id}">${icon('book-marked', 'Atualizar páginas')}</button><button type="button" class="icon-btn small" data-action="edit-book" data-id="${book.id}">${icon('pencil-line', 'Editar livro')}</button><button type="button" class="icon-btn small" data-action="delete-book" data-id="${book.id}">${icon('trash-2', 'Excluir livro')}</button></div>
        </div>
        <p class="module-subtitle">${book.totalPages ? `${book.pagesRead}/${book.totalPages} páginas lidas` : 'Páginas a informar'}${book.genre ? ` · ${escapeHtml(book.genre)}` : ''}${book.dailyGoal ? ` · meta de ${book.dailyGoal} pág./dia` : ''}${book.estimatedDays ? ` · previsão: ${book.estimatedDays} dia(s)` : ''}</p>
        <div class="progress"><span style="width:${book.progress}%"></span></div>
        ${book.notes ? `<p class="module-subtitle">${escapeHtml(book.notes)}</p>` : ''}
      </article>
    `;
  }

  function readingBoardCard(book) {
    const progress = Number(book.progress || 0);
    return `
      <article class="kanban-card reading-kanban-card" draggable="true" data-book-id="${escapeHtml(book.id)}" data-search-id="reading:${escapeHtml(book.id)}" tabindex="0" aria-label="${escapeHtml(book.title)} — ${escapeHtml(book.status)}">
        <div class="kanban-card-head"><strong>${escapeHtml(book.title)}</strong><span class="kanban-card-handle" data-touch-handle aria-label="Arraste para outra etapa">${icon('grip-vertical')}</span></div>
        ${book.author ? `<small class="kanban-muted">${escapeHtml(book.author)}</small>` : ''}
        ${book.totalPages ? `<div class="kanban-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div><small class="kanban-muted">${book.pagesRead} de ${book.totalPages} páginas</small>` : '<small class="kanban-muted">Adicione páginas quando quiser</small>'}
        <div class="kanban-card-footer">
          <select class="kanban-mobile-move" data-move-book="${escapeHtml(book.id)}" aria-label="Mover livro ${escapeHtml(book.title)} para outra coluna">
            ${READING_COLUMNS.map((column) => `<option value="${escapeHtml(column.id)}" ${book.status === column.id ? 'selected' : ''}>${escapeHtml(column.title)}</option>`).join('')}
          </select>
          <div class="inline-actions">
            <button type="button" class="icon-btn small" data-action="update-reading" data-id="${escapeHtml(book.id)}" aria-label="Atualizar páginas">${icon('book-marked')}</button>
            <button type="button" class="icon-btn small" data-action="edit-book" data-id="${escapeHtml(book.id)}" aria-label="Editar livro">${icon('pencil-line')}</button>
            <button type="button" class="icon-btn small" data-action="delete-book" data-id="${escapeHtml(book.id)}" aria-label="Excluir livro">${icon('trash-2')}</button>
          </div>
        </div>
      </article>`;
  }

  function readingBoardLane(column, allBooks) {
    const items = allBooks.filter((book) => book.status === column.id);
    return `<section class="kanban-lane reading-kanban-lane" data-reading-lane="${escapeHtml(column.id)}" aria-label="${column.title}">
      <div class="kanban-lane-heading"><div><h4>${column.title} <span class="kanban-count">${items.length}</span></h4><p>${column.subtitle}</p></div><span class="kanban-lane-dot"></span></div>
      <div class="kanban-lane-items">${items.length ? items.map(readingBoardCard).join('') : '<p class="kanban-empty">Arraste um livro para esta etapa.</p>'}</div>
    </section>`;
  }

  async function moveBookToStatus(bookId, status) {
    const book = getReadingViews(window.__CONTROLY_STATE || {}).find((item) => item.id === bookId);
    if (!book || book.status === status || !READING_STATUSES.includes(status)) return;
    const needsReset = readingMoveNeedsReset(book, status);
    if (needsReset) {
      const confirmed = await confirmDialog({
        title: 'Reiniciar o progresso deste livro?',
        description: `Você já leu ${Number(book.pagesRead)} página(s) de “${book.title}”. Para mover para “${status}”, é necessário zerar as páginas atuais. O histórico anterior será mantido. Deseja continuar?`,
        confirmLabel: 'Zerar páginas e mover',
      });
      if (!confirmed) { render(window.__CONTROLY_STATE || {}); return; }
    }
    const previous = cleanObjectForWrite(book);
    const patch = nextReadingProgress(book, status, () => crypto.randomUUID(), { resetProgress: needsReset });
    try {
      await patchRecord('readingItems', book.id, patch);
      showUndoToast(`Livro movido para ${status}.`, () => saveRecord('readingItems', previous, book.id));
    } catch (error) {
      console.error(error);
      showToast('Não foi possível mover o livro. Tente novamente.', 'error');
      render(window.__CONTROLY_STATE || {});
    }
  }

  function render(state) {
    if (!root) return;
    const oldPosition = root.querySelector('.reading-kanban-board')?.scrollLeft || 0;
    const books = getReadingViews(state);
    root.innerHTML = `
      <div class="section-shell reading-shell">
        <div class="section-head"><div><span class="eyebrow">Sua biblioteca</span><h3>Leitura</h3><p class="module-subtitle">Organize os livros em quadros. Arraste os cartões ou altere a etapa pelo menu.</p></div>
          <div class="section-actions"><button class="btn btn-primary" type="button" data-action="new-book">${icon('plus')} Novo livro</button></div>
        </div>
        <form class="quick-entry kanban-quick-entry" id="reading-quick-form" aria-label="Adicionar livro rapidamente">
          <label class="quick-entry-label" for="reading-quick-title">Qual livro você quer ler?</label>
          <div class="quick-entry-row"><input class="input" id="reading-quick-title" name="title" maxlength="160" autocomplete="off" placeholder="Digite o título e pressione Enter" required /><button class="btn btn-primary" type="submit">Adicionar</button></div>
          <span class="quick-entry-help">Salve apenas o título agora. Complete as informações depois.</span>
        </form>
        <div class="kanban-header"><div><h4>Minha biblioteca</h4><span class="kanban-muted">${books.length} ${books.length === 1 ? 'livro' : 'livros'} no total</span></div><div class="kanban-heading-actions"><span class="kanban-hint">${icon('move-horizontal')} Arraste ou selecione a etapa</span><button class="icon-btn" type="button" data-board-scroll="previous" data-board="reading" aria-label="Ver colunas anteriores" title="Colunas anteriores">${icon('chevron-left')}</button><button class="icon-btn" type="button" data-board-scroll="next" data-board="reading" aria-label="Ver próximas colunas" title="Próximas colunas">${icon('chevron-right')}</button></div></div>
        <div class="kanban-board reading-kanban-board" aria-label="Quadro de livros">
          ${READING_COLUMNS.map((column) => readingBoardLane(column, books)).join('')}
        </div>
      </div>`;
    const board = root.querySelector('.reading-kanban-board');
    if (board) board.scrollLeft = oldPosition;
  }

  function init(element) {
    root = element;
    // Os cartões são arrastáveis, mas a seleção também funciona por toque e teclado.
    enableTouchKanban(root, {
      cardSelector: '[data-book-id]', laneSelector: '[data-reading-lane]',
      boardSelector: '.reading-kanban-board',
      onDrop: (card, lane) => moveBookToStatus(card.dataset.bookId, lane.dataset.readingLane),
    });
    let draggedBookId = null;
    root.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-book-id]');
      if (!card) return;
      draggedBookId = card.dataset.bookId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedBookId);
      card.classList.add('is-dragging');
    });
    root.addEventListener('dragover', (event) => {
      const lane = event.target.closest('[data-reading-lane]');
      if (!draggedBookId) return;
      const board = root.querySelector('.reading-kanban-board');
      if (board) {
        const rect = board.getBoundingClientRect();
        if (event.clientX < rect.left + 65) board.scrollLeft -= 25;
        else if (event.clientX > rect.right - 65) board.scrollLeft += 25;
      }
      if (!lane) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.is-drag-target').forEach((node) => node.classList.remove('is-drag-target'));
      lane.classList.add('is-drag-target');
    });
    root.addEventListener('drop', (event) => {
      const lane = event.target.closest('[data-reading-lane]');
      if (!lane || !draggedBookId) return;
      event.preventDefault();
      const id = draggedBookId;
      draggedBookId = null;
      root.querySelectorAll('.is-drag-target,.is-dragging').forEach((node) => node.classList.remove('is-drag-target', 'is-dragging'));
      moveBookToStatus(id, lane.dataset.readingLane);
    });
    root.addEventListener('dragend', () => {
      draggedBookId = null;
      root.querySelectorAll('.is-drag-target,.is-dragging').forEach((node) => node.classList.remove('is-drag-target', 'is-dragging'));
    });
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.reading = ({ id } = {}) => {
      const book = getReadingViews(window.__CONTROLY_STATE || {}).find((item) => item.id === id);
      if (book) { openBookForm(book); return true; }
      return false;
    };
    root.addEventListener('submit', async (event) => {
      if (event.target.id !== 'reading-quick-form') return;
      event.preventDefault();
      const form = event.target;
      if (form.dataset.saving === 'true') return;
      const input = form.querySelector('input[name="title"]');
      try {
        const title = normalizeQuickTitle(input.value, 'o livro');
        form.dataset.saving = 'true';
        form.querySelector('button[type="submit"]').disabled = true;
        await saveRecord('readingItems', { title, author: '', genre: '', totalPages: 0, pagesRead: 0, status: 'Quero ler', dailyGoal: 0, notes: '', readingLog: [] });
        input.value = '';
        input.focus({ preventScroll: true });
        showToast('Livro adicionado à sua biblioteca.');
      } catch (error) {
        showToast(error?.message?.includes('Escreva') || error?.message?.includes('160') ? error.message : 'Não foi possível adicionar o livro. Tente novamente.', 'error');
      } finally {
        form.dataset.saving = 'false';
        form.querySelector('button[type="submit"]').disabled = false;
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target.matches('[data-move-book]')) {
        moveBookToStatus(event.target.dataset.moveBook, event.target.value);
      }
    });

    root.addEventListener('click', async (event) => {
      const scrollButton = event.target.closest('[data-board-scroll]');
      if (scrollButton) {
        const board = root.querySelector('.reading-kanban-board');
        if (board) board.scrollBy({ left: (scrollButton.dataset.boardScroll === 'next' ? 1 : -1) * Math.max(270, board.clientWidth * .7), behavior: 'smooth' });
        return;
      }
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
