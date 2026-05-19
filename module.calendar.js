import { closeModal, confirmDialog, createEmptyState, icon, openModal, showToast, showUndoToast } from './ui.js';
import { buildAgendaItems } from './domain.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord, toggleDateMapField } from './store.js';
import { cleanObjectForWrite, dateKey, escapeHtml, formatDate, formatMonthLabel, startOfWeek, toDate } from './utils.js';

const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function createCalendarModule() {
  let root;
  let anchorDate = new Date();
  let selectedDateKey = dateKey(new Date());
  let view = 'month';

  function buildMonthDays(baseDate) {
    const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }

  function minutesFromTime(value = '') {
    const parts = String(value || '').split(':').map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
    return parts[0] * 60 + parts[1];
  }

  function normalizeEventRecurrenceType(eventItem = {}) {
    return eventItem.recurrenceType || eventItem.repeat || eventItem.frequency || 'none';
  }

  function recurrenceLabel(eventItem = {}) {
    const type = normalizeEventRecurrenceType(eventItem);
    if (type === 'daily') return 'Repete todo dia';
    if (type === 'interval_days') return `Repete a cada ${Number(eventItem.intervalDays || 1)} dia(s)`;
    if (type === 'monthly_day' || type === 'monthly') return 'Repete todo mês';
    return '';
  }

  function annotateConflicts(items = []) {
    const timed = items.map((item) => {
      const start = minutesFromTime(item.startTime || item.time || '');
      const end = minutesFromTime(item.endTime || '');
      return { item, start, end: end ?? (start !== null ? start + 30 : null) };
    }).filter((entry) => entry.start !== null && entry.end !== null && entry.end > entry.start);
    return items.map((item) => {
      const current = timed.find((entry) => entry.item === item);
      if (!current) return item;
      const hasConflict = timed.some((entry) => entry !== current && entry.start < current.end && current.start < entry.end);
      return { ...item, hasConflict };
    });
  }

  async function handleDeleteEvent(eventItem, options = {}) {
    if (!eventItem?.id) return false;
    const confirmed = await confirmDialog({
      title: 'Excluir item da agenda',
      description: 'Este item será enviado para a lixeira. Você poderá restaurá-lo se precisar.',
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!confirmed) {
      if (options.reopenOnCancel) openEventForm(eventItem);
      return false;
    }
    try {
      const result = await deleteRecord('events', eventItem.id);
      showUndoToast('Item enviado para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
      return true;
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir este item. Tente novamente.', 'error');
      if (options.reopenOnError) openEventForm(eventItem);
      return false;
    }
  }

  function openEventForm(eventItem = null, defaults = {}) {
    const previous = eventItem ? cleanObjectForWrite(eventItem) : null;
    const recurrenceType = normalizeEventRecurrenceType(eventItem || defaults);
    const baseDate = eventItem?.date || defaults.date || selectedDateKey;
    openModal({
      title: eventItem ? 'Editar item da agenda' : 'Criar item',
      eyebrow: 'Minha agenda',
      body: `
        <form id="calendar-event-form" class="stack-form">
          <label class="field"><span>Nome</span><input class="input" name="title" value="${escapeHtml(eventItem?.title || defaults.title || '')}" placeholder="Ex.: Faculdade, aula, revisão" required /></label>
          <div class="inline-fields">
            <label class="field"><span>Data</span><input class="input" type="date" name="date" id="event-date" value="${baseDate}" required /></label>
            <label class="field"><span>Horário de início</span><input class="input" type="time" name="startTime" value="${escapeHtml(eventItem?.startTime || eventItem?.time || defaults.startTime || '')}" /></label>
            <label class="field"><span>Horário de término</span><input class="input" type="time" name="endTime" value="${escapeHtml(eventItem?.endTime || defaults.endTime || '')}" /></label>
          </div>
          <label class="field"><span>Tipo</span><input class="input" name="type" value="${escapeHtml(eventItem?.type || defaults.type || 'Compromisso')}" placeholder="Ex.: Compromisso, prova, lembrete" /></label>
          <details class="section-accordion compact-advanced-options" open>
            <summary><div class="section-accordion-head"><strong>Repetição</strong><div class="section-accordion-meta"><span class="chip" id="event-recurrence-summary">${recurrenceType === 'none' ? 'Não repetir' : escapeHtml(recurrenceLabel(eventItem || defaults))}</span></div></div></summary>
            <div class="section-accordion-body">
              <div class="inline-fields">
                <label class="field"><span>Repetir</span><select class="select" name="recurrenceType" id="event-recurrence-type">
                  <option value="none" ${recurrenceType === 'none' ? 'selected' : ''}>Não repetir</option>
                  <option value="daily" ${recurrenceType === 'daily' ? 'selected' : ''}>Todo dia</option>
                  <option value="interval_days" ${recurrenceType === 'interval_days' ? 'selected' : ''}>A cada X dias</option>
                  <option value="monthly_day" ${recurrenceType === 'monthly_day' || recurrenceType === 'monthly' ? 'selected' : ''}>Uma vez por mês</option>
                </select></label>
                <label class="field event-recurrence-field" data-recurrence-field="interval_days"><span>A cada quantos dias?</span><input class="input" type="number" min="1" step="1" name="intervalDays" value="${Number(eventItem?.intervalDays || eventItem?.recurrenceIntervalDays || defaults.intervalDays || 2)}" placeholder="Ex.: 2" /></label>
                <label class="field event-recurrence-field" data-recurrence-field="monthly_day"><span>Dia do mês</span><input class="input" type="number" min="1" max="31" step="1" name="dayOfMonth" value="${Number(eventItem?.dayOfMonth || defaults.dayOfMonth || toDate(baseDate)?.getDate() || 1)}" /></label>
              </div>
              <div class="inline-fields event-recurrence-field" data-recurrence-field="daily interval_days monthly_day">
                <label class="field"><span>Data final da repetição</span><input class="input" type="date" name="recurrenceEndDate" value="${escapeHtml(eventItem?.recurrenceEndDate || eventItem?.repeatUntil || defaults.recurrenceEndDate || '')}" /></label>
                <div class="muted-box" id="event-recurrence-help"></div>
              </div>
            </div>
          </details>
          <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Informe o que precisa ser lembrado.">${escapeHtml(eventItem?.notes || defaults.notes || '')}</textarea></label>
          <div class="inline-actions calendar-event-form-actions">
            <button type="button" id="calendar-event-cancel" class="btn btn-secondary">Cancelar</button>
            ${eventItem ? '<button type="button" id="calendar-event-delete" class="btn btn-danger">Excluir item</button>' : ''}
            <button type="submit" class="btn btn-primary">${eventItem ? 'Salvar item' : 'Criar item'}</button>
          </div>
        </form>
      `,
    });

    const recurrenceSelect = document.getElementById('event-recurrence-type');
    const recurrenceSummary = document.getElementById('event-recurrence-summary');
    const recurrenceHelp = document.getElementById('event-recurrence-help');
    const syncRecurrenceFields = () => {
      const type = recurrenceSelect?.value || 'none';
      document.querySelectorAll('.event-recurrence-field').forEach((field) => {
        const modes = String(field.dataset.recurrenceField || '').split(' ');
        field.classList.toggle('hidden', !modes.includes(type));
      });
      if (recurrenceSummary) {
        recurrenceSummary.textContent = type === 'daily' ? 'Todo dia' : type === 'interval_days' ? 'A cada X dias' : type === 'monthly_day' ? 'Todo mês' : 'Não repetir';
      }
      if (recurrenceHelp) {
        recurrenceHelp.textContent = type === 'daily'
          ? 'O item aparece todos os dias a partir da data escolhida. A data final é opcional.'
          : type === 'interval_days'
            ? 'Indique o intervalo entre uma ocorrência e outra, como 2, 3 ou 10 dias.'
            : type === 'monthly_day'
              ? 'O item aparece uma vez por mês no dia escolhido. Se o mês não tiver esse dia, ele aparece no último dia do mês.'
              : '';
      }
    };
    recurrenceSelect?.addEventListener('change', syncRecurrenceFields);
    syncRecurrenceFields();

    document.getElementById('calendar-event-cancel').addEventListener('click', closeModal);
    document.getElementById('calendar-event-delete')?.addEventListener('click', () => handleDeleteEvent(eventItem, { reopenOnCancel: true, reopenOnError: true }));
    document.getElementById('calendar-event-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const startTime = data.get('startTime') || '';
      const endTime = data.get('endTime') || '';
      const recurrenceType = data.get('recurrenceType') || 'none';
      const intervalDays = Math.max(1, Number(data.get('intervalDays') || 1));
      const dayOfMonth = Math.max(1, Math.min(31, Number(data.get('dayOfMonth') || toDate(data.get('date'))?.getDate() || 1)));

      if (startTime && endTime && minutesFromTime(endTime) <= minutesFromTime(startTime)) {
        showToast('O horário de término precisa ser depois do horário de início.', 'error');
        return;
      }
      const recurrenceEndDate = data.get('recurrenceEndDate') || '';
      if (recurrenceEndDate && toDate(recurrenceEndDate) < toDate(data.get('date'))) {
        showToast('A data final da repetição precisa ser depois da data inicial.', 'error');
        return;
      }
      const payload = {
        title: data.get('title')?.trim(),
        date: data.get('date'),
        time: startTime,
        startTime,
        endTime,
        type: data.get('type')?.trim() || 'Compromisso',
        notes: data.get('notes')?.trim(),
        recurrenceType,
        intervalDays: recurrenceType === 'interval_days' ? intervalDays : 1,
        dayOfMonth: recurrenceType === 'monthly_day' ? dayOfMonth : null,
        recurrenceEndDate: recurrenceType === 'none' ? '' : recurrenceEndDate,
        completionMap: eventItem?.completionMap || {},
        completed: recurrenceType === 'none' ? (eventItem?.completed || false) : false,
      };
      try {
        await saveRecord('events', payload, eventItem?.recordId || eventItem?.id || null);
        closeModal();
        if (eventItem && previous) {
          showUndoToast('Item atualizado. Você pode desfazer esta alteração.', () => saveRecord('events', previous, eventItem.recordId || eventItem.id));
        } else {
          showToast(recurrenceType === 'none' ? 'Item criado no calendário.' : 'Item recorrente criado no calendário.');
        }
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar este item. Confira as informações e tente novamente.', 'error');
      }
    });
  }


  function itemsForDate(state, key) {
    return annotateConflicts(buildAgendaItems(state, key));
  }

  function agendaItemTemplate(item, options = {}) {
    const showActions = options.actions !== false;
    return `
      <li class="agenda-item ${item.completed ? 'is-complete' : ''}" data-search-id="calendar:${item.id}">
        <div class="item-top">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="item-meta"><span class="chip">${escapeHtml(item.type || item.source)}</span>${item.startTime || item.time ? `<span class="chip">${escapeHtml(item.startTime || item.time)}${item.endTime ? ` - ${escapeHtml(item.endTime)}` : ''}</span>` : ''}${item.hasConflict ? '<span class="tag high">Horários sobrepostos</span>' : ''}${item.source === 'activity' && item.kind === 'recurring' ? '<span class="chip">Atividade da rotina</span>' : ''}${item.source === 'event' && item.recurring ? `<span class="chip">${escapeHtml(recurrenceLabel(item))}</span>` : ''}</div>
            ${item.notes ? `<p class="module-subtitle">${escapeHtml(item.notes)}</p>` : ''}
          </div>
          ${showActions ? `<div class="inline-actions">
            ${['event', 'activity'].includes(item.source) ? `<button type="button" class="icon-btn small agenda-toggle-btn ${item.completed ? 'is-complete' : ''}" data-action="toggle-calendar-item" data-id="${item.id}" data-record-id="${item.recordId || item.id}" data-date="${item.date || item.occurrenceDate || ''}" aria-label="${item.completed ? 'Reabrir item' : 'Marcar como concluído'}">${item.completed ? '✓' : '○'}</button>` : `<span class="tag medium">${escapeHtml(item.type || item.source)}</span>`}
            ${item.source === 'activity' ? `<button type="button" class="icon-btn small" data-action="event-from-item" data-title="${escapeHtml(item.title)}" data-date="${escapeHtml(item.date || item.occurrenceDate || selectedDateKey)}">${icon('calendar-plus', 'Criar item a partir desta atividade')}</button>` : ''}
            ${item.source === 'event' ? `<button type="button" class="btn btn-secondary btn-small agenda-action-btn" data-action="edit-event" data-id="${item.recordId || item.id}">${icon('pencil-line', 'Editar item')}Editar</button><button type="button" class="btn btn-danger btn-small agenda-action-btn" data-action="delete-event" data-id="${item.recordId || item.id}">${icon('trash-2', 'Excluir item')}Excluir</button>` : ''}
            ${item.source === 'goal' ? `<button type="button" class="btn btn-secondary btn-small agenda-action-btn" data-action="open-goal" data-id="${item.recordId || item.id}">${icon('target', 'Abrir meta')}Abrir meta</button>` : ''}
          </div>` : ''}
        </div>
      </li>
    `;
  }

  function renderMonth(state) {
    return `<div class="calendar-grid-wrap"><div class="calendar-grid">${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}${buildMonthDays(anchorDate).map((day) => {
      const key = dateKey(day);
      const dayItems = itemsForDate(state, key);
      const hiddenCount = Math.max(0, dayItems.length - 3);
      return `<button type="button" class="calendar-day ${day.getMonth() === anchorDate.getMonth() ? '' : 'is-other-month'} ${key === selectedDateKey ? 'is-selected' : ''}" data-action="select-date" data-date="${key}"><div class="calendar-day-header"><strong class="day-number">${day.getDate()}</strong></div><div class="calendar-events-preview">${dayItems.slice(0, 3).map((item) => `<span class="calendar-mini-item">${escapeHtml(item.title.slice(0, 16))}</span>`).join('')}${hiddenCount ? `<span class="calendar-mini-item calendar-mini-item-more">+${hiddenCount}</span>` : ''}</div></button>`;
    }).join('')}</div></div>`;
  }

  function countText(count, singular = 'item', plural = 'itens') {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function renderWeek(state) {
    const start = startOfWeek(anchorDate);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return d;
    });
    return `
      <section class="week-view">
        <div class="week-view-head">
          <div>
            <span class="eyebrow">Sua semana</span>
            <h4>Itens da semana</h4>
          </div>
          <span class="chip calendar-week-range">${formatDate(days[0], { day: '2-digit', month: 'short' })} - ${formatDate(days[6], { day: '2-digit', month: 'short' })}</span>
        </div>
        <div class="week-list calendar-week-accordion-list">
          ${days.map((day) => {
            const key = dateKey(day);
            const items = itemsForDate(state, key);
            const isSelected = key === selectedDateKey;
            return `
              <details class="section-accordion calendar-day-accordion ${isSelected ? 'is-selected' : ''}" ${isSelected || items.length ? 'open' : ''}>
                <summary>
                  <div class="section-accordion-head calendar-day-accordion-head">
                    <strong>${formatDate(day, { weekday: 'long', day: '2-digit', month: 'short' })}</strong>
                    <div class="section-accordion-meta"><span class="chip">${countText(items.length, 'item neste dia', 'itens neste dia')}</span></div>
                  </div>
                </summary>
                <div class="section-accordion-body calendar-day-accordion-body">
                  <ul class="agenda-list calendar-readonly-list">
                    ${items.map((item) => agendaItemTemplate(item)).join('') || '<li class="agenda-item"><span class="module-subtitle">Nenhum item planejado para esta data.</span></li>'}
                  </ul>
                </div>
              </details>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderDay(state) {
    const items = itemsForDate(state, selectedDateKey);
    return `<article class="panel"><div class="item-top"><div><span class="eyebrow">Agenda do dia</span><h4>${formatDate(selectedDateKey, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h4></div><button type="button" class="btn btn-primary" data-action="new-event">Adicionar item</button></div><ul class="agenda-list">${items.map(agendaItemTemplate).join('') || createEmptyState('Nenhum item para este dia', 'Aqui aparecem itens com data definida nas outras áreas do sistema.', { label: 'Adicionar item', action: 'new-event' })}</ul></article>`;
  }

  function render(state) {
    if (!root) return;
    const agenda = itemsForDate(state, selectedDateKey);
    root.innerHTML = `
      <div class="section-shell calendar-shell">
        <div class="section-head"><div><span class="eyebrow">Minha agenda</span><h3>Calendário</h3><p class="module-subtitle">Veja compromissos, atividades, metas com prazo, estudos, treinos e datas financeiras.</p></div><div class="section-actions"><button type="button" class="btn btn-secondary" data-action="calendar-today">Ver hoje</button><button type="button" class="btn btn-primary" data-action="new-event">Adicionar item</button></div></div>
        <details class="section-accordion calendar-filter-accordion" open>
          <summary>
            <div class="section-accordion-head">
              <strong>Visualização do calendário</strong>
              <div class="section-accordion-meta"><span class="chip">${view === 'month' ? 'Visão mensal' : view === 'week' ? 'Visão semanal' : 'Visão diária'}</span></div>
            </div>
          </summary>
          <div class="section-accordion-body calendar-filter-body">
            <div class="calendar-toolbar">
              <div class="inline-actions calendar-nav-actions"><button type="button" class="icon-btn" data-action="calendar-prev">‹</button><h4 class="calendar-title">${formatMonthLabel(anchorDate)}</h4><button type="button" class="icon-btn" data-action="calendar-next">›</button></div>
              <div class="view-tabs">${['month','week','day'].map((mode) => `<button type="button" class="tab-btn ${view === mode ? 'active' : ''}" data-action="calendar-view" data-view="${mode}">${mode === 'month' ? 'Mês' : mode === 'week' ? 'Semana' : 'Dia'}</button>`).join('')}</div>
            </div>
          </div>
        </details>

        ${view === 'month' ? renderMonth(state) : view === 'week' ? renderWeek(state) : renderDay(state)}
        <div class="calendar-agenda mobile-rail-group"><article class="panel"><span class="eyebrow">Resumo da data selecionada</span><h4>${formatDate(selectedDateKey, { weekday: 'long', day: '2-digit', month: 'long' })}</h4><ul class="agenda-list calendar-readonly-list">${agenda.map((item) => agendaItemTemplate(item)).join('') || createEmptyState('Nenhum item nesta data', 'Aqui aparecem atividades, metas, estudos e lançamentos com data definida.', { label: 'Adicionar item', action: 'new-event' })}</ul></article></div>
      </div>
    `;
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.calendar = ({ id, date } = {}) => {
      const state = window.__CONTROLY_STATE || {};
      const eventItem = (state.events || []).find((item) => item.id === id);
      if (date) { selectedDateKey = date; anchorDate = toDate(date) || anchorDate; }
      if (eventItem) { openEventForm(eventItem); return true; }
      render(state);
      return false;
    };
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const state = window.__CONTROLY_STATE;
      const eventRecordId = button.dataset.recordId || button.dataset.id;
      const eventItem = (state.events || []).find((item) => item.id === eventRecordId);
      const activityItem = buildAgendaItems(state, button.dataset.date || selectedDateKey).find((item) => item.source === 'activity' && (item.id === button.dataset.id || item.occurrenceId === button.dataset.id || item.recordId === button.dataset.recordId));
      const navigationAction = ['calendar-prev', 'calendar-next', 'calendar-today', 'calendar-view', 'select-date'].includes(action);

      if (action === 'calendar-prev') anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
      if (action === 'calendar-next') anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
      if (action === 'calendar-today') { anchorDate = new Date(); selectedDateKey = dateKey(new Date()); }
      if (action === 'calendar-view') view = button.dataset.view;
      if (action === 'select-date') { selectedDateKey = button.dataset.date; anchorDate = toDate(selectedDateKey) || new Date(); }
      if (action === 'new-event') openEventForm();
      if (action === 'event-from-item') openEventForm(null, { title: button.dataset.title || '', date: button.dataset.date || selectedDateKey, type: 'Lembrete de atividade' });
      if (action === 'edit-event' && eventItem) openEventForm(eventItem);
      if (action === 'delete-event' && eventItem) await handleDeleteEvent(eventItem);
      if (action === 'open-goal') {
        const opened = window.__CONTROLY_OPENERS?.goals?.({ id: button.dataset.id });
        if (!opened) showToast('Abra a área de metas para ver este item.', 'info');
      }
      if (action === 'toggle-calendar-item') {
        const occurrenceDate = button.dataset.date || selectedDateKey;
        const eventIsRecurring = eventItem && normalizeEventRecurrenceType(eventItem) !== 'none';
        const eventDone = eventIsRecurring ? Boolean(eventItem.completionMap?.[occurrenceDate]) : Boolean(eventItem?.completed);
        const nextDone = eventItem ? !eventDone : activityItem ? !activityItem.occurrenceDone : false;
        const previousText = button.textContent;
        button.classList.toggle('is-complete', nextDone);
        button.textContent = nextDone ? '✓' : '○';
        button.closest('.agenda-item')?.classList.toggle('is-complete', nextDone);
        try {
          if (eventItem) {
            if (eventIsRecurring) {
              await toggleDateMapField('events', eventItem.id, 'completionMap', occurrenceDate, nextDone);
              showUndoToast(nextDone ? 'Ocorrência marcada como concluída.' : 'Ocorrência reaberta.', () => toggleDateMapField('events', eventItem.id, 'completionMap', occurrenceDate, eventDone));
            } else {
              await patchRecord('events', eventItem.id, { completed: !eventItem.completed });
              showUndoToast(!eventItem.completed ? 'Item marcado como concluído.' : 'Item reaberto para acompanhamento.', () => patchRecord('events', eventItem.id, { completed: Boolean(eventItem.completed) }));
            }
          } else if (activityItem) {
            const checklist = Array.isArray(activityItem.checklist) ? activityItem.checklist : [];
            if (checklist.length) {
              const nextMap = {};
              checklist.forEach((task) => { nextMap[task.id || task.text || String(task)] = !activityItem.occurrenceDone; });
              await patchRecord(activityItem.sourceCollection || 'activities', activityItem.recordId || activityItem.id, { [`checklistStatusMap.${activityItem.occurrenceDate}`]: nextMap });
            } else if (activityItem.kind === 'recurring') {
              await toggleDateMapField(activityItem.sourceCollection || 'activities', activityItem.recordId || activityItem.id, activityItem.completionField || 'completionMap', activityItem.occurrenceDate, !activityItem.occurrenceDone);
            } else {
              await patchRecord(activityItem.sourceCollection || 'activities', activityItem.recordId || activityItem.id, { completed: !activityItem.occurrenceDone, completedAt: !activityItem.occurrenceDone ? new Date() : null });
            }
          }
          if (!eventItem) showToast('Item atualizado com sucesso.');
        } catch (error) {
          button.textContent = previousText;
          button.classList.toggle('is-complete', !nextDone);
          button.closest('.agenda-item')?.classList.toggle('is-complete', !nextDone);
          console.error(error);
          showToast('Não foi possível atualizar este item. Tente novamente.', 'error');
        }
      }
      if (navigationAction) render(window.__CONTROLY_STATE || state);
    });
  }

  return { id: 'calendar', init, render };
}