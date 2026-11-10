/** Movimentação por toque dos quadros de Finanças e Leitura.
 * Rola horizontalmente no sentido em que o cartão é movido, sem mexer nos dados.
 * O módulo continua responsável pela validação e confirmação da mudança.
 */
export function horizontalDragScroll(previousX, currentX) {
  return (currentX - previousX) * 1.25;
}

export function enableTouchKanban(root, { cardSelector, laneSelector, boardSelector, onDrop, canDrop = () => true }) {
  let gesture = null;
  let scrollFrame = 0;
  const clearTargets = () => root.querySelectorAll('.is-drag-target,.is-invalid-drag-target')
    .forEach(el => el.classList.remove('is-drag-target', 'is-invalid-drag-target'));
  const cleanup = () => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const g = gesture;
    if (!g) return;
    g.card.classList.remove('is-touch-source');
    g.card.draggable = g.originalDraggable;
    g.board.classList.remove('is-touch-dragging');
    g.ghost?.remove();
    clearTargets();
    gesture = null;
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function refreshTarget() {
    const g = gesture;
    if (!g?.active) return;
    const rect = g.board.getBoundingClientRect();
    const x = clamp(g.x, rect.left + 3, rect.right - 3);
    const y = clamp(g.y, rect.top + 12, rect.bottom - 12);
    const hit = document.elementFromPoint(x, y)?.closest(laneSelector);
    let lane = hit && g.board.contains(hit) ? hit : null;
    if (!lane) {
      // O dedo pode estar sobre o espaço entre duas colunas; seleciona a mais próxima.
      const lanes = [...g.board.querySelectorAll(laneSelector)];
      lane = lanes.reduce((nearest, candidate) => {
        const r = candidate.getBoundingClientRect();
        const distance = Math.abs(x - (r.left + r.right) / 2);
        return distance < nearest.distance ? { element: candidate, distance } : nearest;
      }, { element: null, distance: Infinity }).element;
    }
    const valid = Boolean(lane && canDrop(g.card, lane));
    if (g.lane !== lane || g.valid !== valid) {
      clearTargets();
      lane?.classList.add(valid ? 'is-drag-target' : 'is-invalid-drag-target');
      g.lane = lane;
      g.valid = valid;
    }
    if (g.ghost) {
      const label = lane?.querySelector('h4')?.textContent?.trim() || lane?.getAttribute('aria-label') || '';
      g.ghost.querySelector('.touch-kanban-destination').textContent = label
        ? (valid ? `Mover para: ${label}` : 'Movimentação indisponível')
        : 'Arraste até uma coluna';
    }
  }
  function autoScroll() {
    scrollFrame = 0;
    const g = gesture;
    if (!g?.active) return;
    const r = g.board.getBoundingClientRect();
    const edge = 82;
    const rightRatio = clamp((g.x - (r.right - edge)) / edge, 0, 1);
    const leftRatio = clamp(((r.left + edge) - g.x) / edge, 0, 1);
    if (rightRatio) g.board.scrollLeft += 4 + rightRatio * 20;
    else if (leftRatio) g.board.scrollLeft -= 4 + leftRatio * 20;
    refreshTarget();
    scrollFrame = requestAnimationFrame(autoScroll);
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const handle = event.target.closest('[data-touch-handle]');
    const card = handle?.closest(cardSelector);
    const board = card?.closest(boardSelector);
    if (!handle || !card || !board || !root.contains(board)) return;
    cleanup();
    const originalDraggable = card.draggable;
    card.draggable = false;
    gesture = { pointerId: event.pointerId, originalDraggable, handle, card, board,
      startX: event.clientX, startY: event.clientY, x: event.clientX,
      y: event.clientY, lastX: event.clientX, active: false, lane: null, valid: false, ghost: null };
    try { handle.setPointerCapture(event.pointerId); } catch { /* sem captura */ }
  });
  root.addEventListener('pointermove', (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    if (!g.active && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 8) return;
    if (!g.active) {
      g.active = true;
      g.board.classList.add('is-touch-dragging');
      g.card.classList.add('is-touch-source');
      const ghost = document.createElement('div');
      ghost.className = 'touch-kanban-ghost';
      ghost.innerHTML = '<strong class="touch-kanban-title"></strong><small class="touch-kanban-destination"></small>';
      ghost.querySelector('strong').textContent = g.card.querySelector('.finance-compact-title,.finance-entry-title,.kanban-card-head strong')?.textContent?.trim() || 'Movendo cartão';
      ghost.setAttribute('aria-hidden', 'true');
      document.body.append(ghost);
      g.ghost = ghost;
    }
    event.preventDefault();
    const horizontalMove = horizontalDragScroll(g.lastX, event.clientX);
    // Arrastar para a direita revela imediatamente as colunas à direita (e vice-versa).
    // Funciona antes de alcançar a borda; o auto-scroll continua se o dedo permanecer nela.
    g.board.scrollLeft += horizontalMove;
    g.lastX = event.clientX;
    g.x = event.clientX;
    g.y = event.clientY;
    g.ghost.style.left = `${g.x}px`;
    g.ghost.style.top = `${g.y - 68}px`;
    refreshTarget();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
  }, { passive: false });
  root.addEventListener('pointerup', (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const { active, lane, valid, card } = g;
    cleanup();
    if (active && lane && valid) Promise.resolve(onDrop(card, lane)).catch(error => {
      console.error('Não foi possível mover o cartão', error);
    });
  });
  root.addEventListener('pointercancel', (event) => {
    if (gesture && event.pointerId === gesture.pointerId) cleanup();
  });
  window.addEventListener('blur', cleanup);
}
