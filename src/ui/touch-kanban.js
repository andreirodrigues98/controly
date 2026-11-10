/** Arrastar cartões por toque/caneta, sem depender do HTML Drag and Drop nativo.
 * Ativa somente no ícone de arrastar; campos e botões continuam funcionando.
 * Escopo: um quadro por interação. Não persiste dados; a regra do módulo decide.
 */
export function enableTouchKanban(root, { cardSelector, laneSelector, boardSelector, onDrop }) {
  let gesture = null;
  let scrollFrame = 0;
  const clearTargets = () => root.querySelectorAll('.is-drag-target').forEach(el => el.classList.remove('is-drag-target'));
  const cleanup = () => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (!gesture) return;
    gesture.card.classList.remove('is-touch-source');
    gesture.card.draggable = gesture.originalDraggable;
    gesture.ghost?.remove();
    clearTargets();
    gesture = null;
  };
  function refreshTarget(x, y) {
    const g = gesture;
    if (!g) return;
    const hit = document.elementFromPoint(x, y)?.closest(laneSelector);
    const lane = hit && g.board.contains(hit) ? hit : null;
    if (g.lane !== lane) { clearTargets(); lane?.classList.add('is-drag-target'); g.lane = lane; }
  }
  // Continua rolando a coluna enquanto o dedo permanece junto à borda.
  function scrollWhileDragging() {
    scrollFrame = 0;
    const g = gesture;
    if (!g?.active) return;
    const rect = g.board.getBoundingClientRect();
    if (g.x > rect.right - 55) g.board.scrollLeft += 20;
    else if (g.x < rect.left + 55) g.board.scrollLeft -= 20;
    refreshTarget(g.x, g.y);
    scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }
  root.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const handle = event.target.closest('[data-touch-handle]');
    const card = handle?.closest(cardSelector);
    const board = card?.closest(boardSelector);
    if (!handle || !card || !board || !root.contains(board)) return;
    if (gesture) cleanup();
    // Impede que o DnD HTML do desktop cancele o gesto de toque.
    const originalDraggable = card.draggable;
    card.draggable = false;
    gesture = { originalDraggable, pointerId: event.pointerId, handle, card, board, startX: event.clientX,
      startY: event.clientY, x: event.clientX, y: event.clientY, active: false, ghost: null, lane: null };
    // Captura mantém o movimento mesmo depois de sair dos limites do cartão.
    try { handle.setPointerCapture(event.pointerId); } catch { /* navegador sem suporte */ }
  });
  root.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    if (!g.active && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 9) return;
    if (!g.active) {
      g.active = true;
      g.card.classList.add('is-touch-source');
      const ghost = document.createElement('div');
      ghost.className = 'touch-kanban-ghost';
      ghost.textContent = g.card.querySelector('strong')?.textContent?.trim() || 'Movendo cartão';
      ghost.setAttribute('aria-hidden', 'true');
      document.body.append(ghost);
      g.ghost = ghost;
    }
    event.preventDefault();
    g.x = event.clientX; g.y = event.clientY;
    if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollWhileDragging);
    if (g.ghost) {
      g.ghost.style.left = `${event.clientX}px`;
      g.ghost.style.top = `${event.clientY - 58}px`;
    }
    refreshTarget(event.clientX, event.clientY);
  }, { passive: false });
  root.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    const dragged = g.active;
    const lane = g.lane;
    const card = g.card;
    cleanup();
    if (dragged && lane) Promise.resolve(onDrop(card, lane)).catch(error => {
      console.error('Não foi possível mover o cartão', error);
    });
  });
  root.addEventListener('pointercancel', cleanup);
  window.addEventListener('blur', cleanup);
}
