import { closeModal, confirmDialog, createEmptyState, openModal, showToast, showUndoToast } from "./ui.js";
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from "./store.js";
import { cleanObjectForWrite, escapeHtml, formatMultilineText, normalizeSearchText, stripHtml } from "./utils.js";

const NOTE_COLORS = [
  { value: '', label: 'Padrão', swatch: 'default' },
  { value: '#6B7280', label: 'Cinza', swatch: '#6B7280' },
  { value: '#B91C1C', label: 'Vermelho', swatch: '#B91C1C' },
  { value: '#B7791F', label: 'Dourado', swatch: '#B7791F' },
  { value: '#15803D', label: 'Verde', swatch: '#15803D' },
  { value: '#2563EB', label: 'Azul', swatch: '#2563EB' },
  { value: '#7C3AED', label: 'Roxo', swatch: '#7C3AED' },
];

function sanitizeInlineStyle(styleValue = '') {
  const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleValue || '');
  if (!colorMatch) return '';
  const color = colorMatch[1].trim();
  const isSafeColor = /^#[0-9a-f]{3,8}$/i.test(color)
    || /^rgb(a)?\([0-9.,%\s]+\)$/i.test(color)
    || ['inherit', 'currentcolor'].includes(color.toLowerCase());
  return isSafeColor ? `color:${color}` : '';
}

function unwrapElement(node) {
  const fragment = document.createDocumentFragment();
  while (node.firstChild) fragment.appendChild(node.firstChild);
  node.replaceWith(fragment);
}

function normalizeRichText(value = '') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '');
  wrapper.querySelectorAll('*').forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (!['strong', 'b', 'em', 'i', 'br', 'span', 'div', 'p', 'ul', 'ol', 'li'].includes(tag)) {
      unwrapElement(node);
      return;
    }
    [...node.attributes].forEach((attr) => {
      if (attr.name !== 'style') node.removeAttribute(attr.name);
    });
    const safeStyle = sanitizeInlineStyle(node.getAttribute('style') || '');
    if (safeStyle) node.setAttribute('style', safeStyle);
    else node.removeAttribute('style');
    if (tag === 'span' && !node.getAttribute('style')) unwrapElement(node);
  });
  return wrapper.innerHTML.trim();
}

function renderNoteContent(value = '') {
  const stringValue = String(value || '');
  const hasHtml = /<[^>]+>/.test(stringValue);
  if (!hasHtml) return formatMultilineText(stringValue);
  return normalizeRichText(stringValue).replace(/\n/g, '<br />');
}

function noteContentForEdit(value = '') {
  const stringValue = String(value || '');
  if (!/<[^>]+>/.test(stringValue)) return stringValue;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = normalizeRichText(stringValue);
  wrapper.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  wrapper.querySelectorAll('p, div, li').forEach((node) => {
    if (node.nextSibling && !String(node.textContent || '').endsWith('\n')) {
      node.appendChild(document.createTextNode('\n'));
    }
  });

  return (wrapper.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function parseNoteTags(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function getNoteTags(note = {}) {
  return Array.isArray(note.tags) ? note.tags.filter(Boolean) : parseNoteTags(note.tags || note.tag || '');
}

function getEditor() {
  return document.getElementById('note-editor');
}

function selectionBelongsToEditor(editor, range) {
  if (!editor || !range) return false;
  const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentNode;
  const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentNode;
  return editor.contains(startNode) && editor.contains(endNode);
}

function getEditorSelectionRange() {
  const editor = getEditor();
  const selection = window.getSelection();
  if (!editor || !selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return selectionBelongsToEditor(editor, range) ? range : null;
}

function ensureEditorSelection() {
  const editor = getEditor();
  const selection = window.getSelection();
  if (!editor || !selection) return null;

  const currentRange = getEditorSelectionRange();
  if (currentRange) {
    editor.__savedRange = currentRange.cloneRange();
    return currentRange;
  }

  if (editor.__savedRange) {
    selection.removeAllRanges();
    selection.addRange(editor.__savedRange);
    return editor.__savedRange;
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.__savedRange = range.cloneRange();
  return range;
}

function closestInlineFormat(node, selector, editor) {
  let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (current && current !== editor) {
    if (current.matches?.(selector)) return current;
    current = current.parentElement;
  }
  return null;
}

function getSelectionFormatState() {
  const editor = getEditor();
  const range = getEditorSelectionRange() || editor?.__savedRange;
  if (!editor || !range) return { bold: false, italic: false };
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const computed = node && editor.contains(node) ? window.getComputedStyle(node) : null;
  const weight = computed ? Number.parseInt(computed.fontWeight, 10) : 400;
  return {
    bold: Boolean(closestInlineFormat(node, 'b,strong', editor)) || weight >= 600 || document.queryCommandState('bold'),
    italic: Boolean(closestInlineFormat(node, 'i,em', editor)) || computed?.fontStyle === 'italic' || document.queryCommandState('italic'),
  };
}

function saveEditorSelection() {
  const editor = getEditor();
  const range = getEditorSelectionRange();
  if (editor && range) editor.__savedRange = range.cloneRange();
}

function restoreEditorSelection() {
  return Boolean(ensureEditorSelection());
}

function normalizeColorValue(value = '') {
  const color = String(value || '').trim();
  if (!color) return '';
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split('').map((char) => char + char).join('').toUpperCase()}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return color.toUpperCase();
}

function getActiveEditorColor() {
  const editor = getEditor();
  const range = getEditorSelectionRange();
  if (!editor || !range) return '';
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentNode;
  if (!node || !editor.contains(node)) return '';
  const editorColor = normalizeColorValue(window.getComputedStyle(editor).color);
  const nodeColor = normalizeColorValue(window.getComputedStyle(node).color);
  const match = NOTE_COLORS.find((entry) => entry.value && normalizeColorValue(entry.value) === nodeColor);
  if (match) return match.value;
  return nodeColor && nodeColor !== editorColor ? nodeColor : '';
}

function setToolbarColorState(color = '') {
  const normalized = normalizeColorValue(color);
  document.querySelectorAll('[data-editor-color]').forEach((button) => {
    const buttonColor = normalizeColorValue(button.dataset.editorColor || '');
    const active = buttonColor === normalized;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const label = document.getElementById('note-color-label');
  const match = NOTE_COLORS.find((entry) => normalizeColorValue(entry.value || '') === normalized);
  if (label) label.textContent = match ? `Cor do texto: ${match.label}` : 'Cor do texto: Personalizada';
}

function updateFormatButtonState() {
  const editor = getEditor();
  if (!editor) return;
  const range = getEditorSelectionRange();
  const editorIsActive = document.activeElement === editor;
  if (!range && !editorIsActive) return;

  const formatState = getSelectionFormatState();
  const boldActive = formatState.bold;
  const italicActive = formatState.italic;
  document.querySelectorAll('[data-editor-command="bold"]').forEach((button) => {
    button.classList.toggle('is-active', boldActive);
    button.setAttribute('aria-pressed', boldActive ? 'true' : 'false');
  });
  document.querySelectorAll('[data-editor-command="italic"]').forEach((button) => {
    button.classList.toggle('is-active', italicActive);
    button.setAttribute('aria-pressed', italicActive ? 'true' : 'false');
  });
  setToolbarColorState(getActiveEditorColor());
}

function cleanEmptySpans(root) {
  root.querySelectorAll('span').forEach((span) => {
    if (!span.getAttribute('style')) unwrapElement(span);
  });
}

function removeColorFromFragment(fragment) {
  fragment.querySelectorAll('[style]').forEach((node) => {
    const style = node.getAttribute('style') || '';
    const nextStyle = style
      .split(';')
      .map((item) => item.trim())
      .filter((item) => item && !/^color\s*:/i.test(item))
      .join('; ');
    if (nextStyle) node.setAttribute('style', nextStyle);
    else node.removeAttribute('style');
  });
  cleanEmptySpans(fragment);
  return fragment;
}

function applyColorToSelection(color = '') {
  const editor = getEditor();
  if (!editor) return;
  editor.focus({ preventScroll: true });
  const range = ensureEditorSelection();
  const selection = window.getSelection();
  if (!range || !selection || !selectionBelongsToEditor(editor, range)) return;

  const normalizedColor = color ? normalizeColorValue(color) : '';
  editor.dataset.pendingColor = normalizedColor;

  document.execCommand('styleWithCSS', false, true);

  if (range.collapsed) {
    const nextColor = normalizedColor || window.getComputedStyle(editor).color;
    document.execCommand('foreColor', false, nextColor);
    saveEditorSelection();
    setToolbarColorState(normalizedColor);
    return;
  }

  const extracted = removeColorFromFragment(range.extractContents());
  const nextRange = document.createRange();

  if (normalizedColor) {
    const span = document.createElement('span');
    span.style.color = normalizedColor;
    span.appendChild(extracted);
    range.insertNode(span);
    nextRange.setStartAfter(span);
  } else {
    const fragment = document.createDocumentFragment();
    while (extracted.firstChild) fragment.appendChild(extracted.firstChild);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode && lastNode.parentNode) nextRange.setStartAfter(lastNode);
    else nextRange.selectNodeContents(editor);
  }

  nextRange.collapse(true);
  editor.normalize();
  selection.removeAllRanges();
  selection.addRange(nextRange);
  saveEditorSelection();
  setToolbarColorState(normalizedColor);
}



export function createNotesModule() {
  let root;
  let search = "";
  let visibilityFilter = "active";

  function filteredNotes(notes) {
    const term = normalizeSearchText(search);
    return [...notes]
      .filter((note) => {
        if (visibilityFilter === "active" && note.archived) return false;
        if (visibilityFilter === "archived" && !note.archived) return false;
        if (visibilityFilter === "favorites" && !note.favorite) return false;
        if (!term) return true;
        const haystack = normalizeSearchText(`${note.title || ""} ${stripHtml(note.content || "")} ${note.tag || ""} ${getNoteTags(note).join(" ")}`);
        return haystack.includes(term);
      })
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
  }

  function applyEditorCommand(command, value = null) {
    const editor = getEditor();
    if (!editor) return;
    editor.focus({ preventScroll: true });
    ensureEditorSelection();

    if (command === 'foreColor') {
      applyColorToSelection(value || '');
    } else if (command === 'removeFormat') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('removeFormat', false, null);
      editor.normalize();
      saveEditorSelection();
      setToolbarColorState(getActiveEditorColor());
    } else if (command === 'bold' || command === 'italic') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(command, false, null);
      saveEditorSelection();
    } else {
      document.execCommand(command, false, value);
      saveEditorSelection();
    }

    window.setTimeout(updateFormatButtonState, 0);
  }


  function openViewAll(note) {
    openModal({
      title: note.title || "Nota",
      eyebrow: note.tag || "Minhas notas",
      body: `
        <div class="stack-form modal-scroll-form">
          <div class="rich-preview rich-preview-full">${renderNoteContent(note.content || "")}</div>
          <div class="item-meta"><span class="chip">${note.pinned ? "Fixada no topo" : "Nota salva"}</span><span class="chip">${formatDate(note.updatedAt || note.createdAt || new Date(), { day: "2-digit", month: "short", year: "numeric" })}</span></div>
          <div class="inline-actions sticky-modal-actions"><button type="button" class="btn btn-secondary" id="note-view-close">Fechar</button></div>
        </div>
      `,
    });
    document.getElementById("note-view-close")?.addEventListener("click", closeModal);
  }

  function openNoteForm(note = null) {
    openModal({
      title: note ? "Editar nota" : "Criar nova nota",
      eyebrow: "Anotações e lembretes",
      body: `
        <form id="note-form" class="stack-form modal-scroll-form">
          <label class="field">
            <span>Título da nota</span>
            <input class="input" name="title" value="${escapeHtml(note?.title || "")}" placeholder="Ex.: Ideia para estudar depois" required />
          </label>
          <div class="inline-fields">
            <label class="field">
              <span>Categoria</span>
              <input class="input" name="tag" value="${escapeHtml(note?.tag || "")}" placeholder="Ex.: Ideias, faculdade, trabalho" />
            </label>
            <label class="field">
              <span>Deseja deixar esta nota em destaque?</span>
              <select class="select" name="pinned">
                <option value="false" ${note?.pinned ? "" : "selected"}>Não</option>
                <option value="true" ${note?.pinned ? "selected" : ""}>Sim, mostrar no topo</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span>Palavras-chave (opcional)</span>
            <input class="input" name="tags" value="${escapeHtml(getNoteTags(note || {}).join(', '))}" placeholder="Ex.: prova, ideia, cliente" />
          </label>
          <label class="field note-content-field">
            <span>Conteúdo da nota</span>
            <small class="field-help">Escreva sua nota livremente. As quebras de linha serão mantidas quando você abrir a nota depois.</small>
            <textarea class="textarea note-textarea" name="content" id="note-content-input" placeholder="Escreva sua nota aqui..." rows="10">${escapeHtml(noteContentForEdit(note?.content || ""))}</textarea>
          </label>
          <div class="inline-actions sticky-modal-actions">
            <button type="button" id="note-form-cancel" class="btn btn-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">${note ? "Salvar nota" : "Criar nota"}</button>
          </div>
        </form>
      `,
    });

    const noteTextarea = document.getElementById("note-content-input");
    window.setTimeout(() => noteTextarea?.focus({ preventScroll: true }), 50);

    document.getElementById("note-form-cancel")?.addEventListener("click", closeModal);
    document.getElementById("note-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        title: formData.get("title")?.trim(),
        tag: formData.get("tag")?.trim(),
        tags: parseNoteTags(formData.get("tags")),
        content: formData.get("content")?.trim(),
        pinned: formData.get("pinned") === "true",
        archived: Boolean(note?.archived),
        favorite: Boolean(note?.favorite)
      };

      try {
        const previous = note ? cleanObjectForWrite(note) : null;
        const saved = await saveRecord("notes", payload, note?.id || null);
        closeModal();
        if (note && previous) showUndoToast("Nota atualizada. Se precisar, você pode desfazer essa alteração.", () => saveRecord("notes", previous, note.id));
        else showUndoToast("Nota criada. Ela ficou salva para consultar quando precisar.", () => deleteRecord("notes", saved.id));
      } catch (error) {
        console.error(error);
        showToast("Não foi possível salvar a nota. Confira as informações e tente novamente.", "error");
      }
    });
  }

  async function handleDelete(note) {
    const confirmed = await confirmDialog({
      title: "Excluir nota",
      description: "Esta nota será enviada para a lixeira e poderá ser restaurada por 7 dias antes de ser apagada definitivamente.",
      confirmLabel: "Enviar para a lixeira",
    });
    if (!confirmed) return;

    try {
      const result = await deleteRecord("notes", note.id);
      showUndoToast("Nota enviada para a lixeira. Você pode restaurar se precisar.", () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast("Não foi possível excluir a nota. Tente novamente.", "error");
    }
  }

  function render(state) {
    if (!root) return;
    const notes = filteredNotes(state.notes);

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div>
            <span class="eyebrow">Minhas anotações</span>
            <h3>Notas e lembretes</h3>
            <p class="module-subtitle">Salve ideias, lembretes, observações e informações importantes para consultar quando precisar.</p>
          </div>
          <div class="section-actions">
            <button class="btn btn-primary" type="button" data-action="new-note">Criar nota</button>
          </div>
        </div>

        <article class="panel">
          <div class="filter-row">
            <input class="input" id="notes-search" placeholder="Buscar por título, categoria, palavra-chave ou conteúdo" value="${escapeHtml(search)}" />
            <select class="select" id="notes-visibility-filter">
              <option value="active" ${visibilityFilter === "active" ? "selected" : ""}>Notas ativas</option>
              <option value="favorites" ${visibilityFilter === "favorites" ? "selected" : ""}>Favoritas</option>
              <option value="archived" ${visibilityFilter === "archived" ? "selected" : ""}>Arquivadas</option>
              <option value="all" ${visibilityFilter === "all" ? "selected" : ""}>Todas as notas</option>
            </select>
          </div>
        </article>

        <div class="section-accordion-stack">
          ${notes.map((note, index) => `
            <details class="section-accordion note-accordion" ${index < 3 ? "open" : ""} data-search-id="notes:${note.id}">
              <summary>
                <div class="section-accordion-head">
                  <strong>${escapeHtml(note.title)}</strong>
                  <div class="section-accordion-meta">
                    ${note.tag ? `<span class="chip">${escapeHtml(note.tag)}</span>` : ""}
                    ${getNoteTags(note).slice(0, 3).map((tag) => `<span class="chip">#${escapeHtml(tag)}</span>`).join("")}
                    ${note.favorite ? '<span class="tag success">Favorita</span>' : ""}
                    ${note.archived ? '<span class="tag muted">Arquivada</span>' : ""}
                    ${note.pinned ? '<span class="tag success">Fixada no topo</span>' : ""}
                  </div>
                </div>
              </summary>
              <div class="section-accordion-body">
                <div class="item-top">
                  <div class="module-subtitle">Veja a nota como ela foi salva, com quebras de linha e formatação.</div>
                  <div class="inline-actions note-actions-row">
                    <button type="button" class="btn btn-secondary btn-small" data-action="view-note" data-id="${note.id}">Abrir nota</button>
                    <button type="button" class="btn btn-secondary btn-small" title="${note.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}" data-action="toggle-favorite" data-id="${note.id}">${note.favorite ? "Remover dos favoritos" : "Favoritar"}</button>
                    <button type="button" class="btn btn-secondary btn-small" title="${note.pinned ? "Remover nota do topo" : "Mostrar nota no topo"}" data-action="toggle-pin" data-id="${note.id}">${note.pinned ? "Remover do topo" : "Fixar no topo"}</button>
                    <button type="button" class="btn btn-secondary btn-small" title="${note.archived ? "Restaurar nota arquivada" : "Arquivar nota"}" data-action="toggle-archive" data-id="${note.id}">${note.archived ? "Restaurar" : "Arquivar"}</button>
                    <button type="button" class="btn btn-secondary btn-small" data-action="edit-note" data-id="${note.id}">Editar</button>
                    <button type="button" class="btn btn-danger btn-small" data-action="delete-note" data-id="${note.id}">Excluir</button>
                  </div>
                </div>
                <div class="rich-preview">${renderNoteContent(note.content || "")}</div>
              </div>
            </details>
          `).join("") || createEmptyState("Nenhuma nota criada ainda", "Use as notas para guardar ideias, lembretes ou informações importantes.", { label: "Criar nota", action: "new-note" })}
        </div>
      </div>
    `;
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.notes = ({ id } = {}) => {
      const note = (window.__CONTROLY_STATE?.notes || []).find((item) => item.id === id);
      if (note) { openViewAll(note); return true; }
      return false;
    };

    root.addEventListener("input", (event) => {
      if (event.target.id === "notes-search") {
        search = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });

    root.addEventListener("change", (event) => {
      if (event.target.id === "notes-visibility-filter") {
        visibilityFilter = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });

    root.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      const noteId = button.dataset.id;
      const note = noteId ? window.__CONTROLY_STATE.notes.find((item) => item.id === noteId) : null;

      if (action === "new-note") openNoteForm();
      if (action === "edit-note" && note) openNoteForm(note);
      if (action === "view-note" && note) openViewAll(note);
      if (action === "delete-note" && note) await handleDelete(note);
      if (action === "toggle-pin" && note) {
        try {
          await patchRecord("notes", note.id, { pinned: !note.pinned });
          showUndoToast(note.pinned ? "Nota removida do topo." : "Nota fixada no topo.", () => patchRecord("notes", note.id, { pinned: Boolean(note.pinned) }));
        } catch (error) {
          console.error(error);
          showToast("Não foi possível atualizar a nota. Tente novamente.", "error");
        }
      }
      if (action === "toggle-favorite" && note) {
        try {
          await patchRecord("notes", note.id, { favorite: !note.favorite });
          showUndoToast(note.favorite ? "Nota removida dos favoritos." : "Nota adicionada aos favoritos.", () => patchRecord("notes", note.id, { favorite: Boolean(note.favorite) }));
        } catch (error) {
          console.error(error);
          showToast("Não foi possível atualizar a nota. Tente novamente.", "error");
        }
      }
      if (action === "toggle-archive" && note) {
        try {
          await patchRecord("notes", note.id, { archived: !note.archived });
          showUndoToast(note.archived ? "Nota restaurada." : "Nota arquivada.", () => patchRecord("notes", note.id, { archived: Boolean(note.archived) }));
        } catch (error) {
          console.error(error);
          showToast("Não foi possível atualizar a nota. Tente novamente.", "error");
        }
      }
    });
  }

  return { id: "notes", init, render };
}
